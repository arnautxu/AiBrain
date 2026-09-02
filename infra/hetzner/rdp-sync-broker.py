#!/usr/bin/env python3
"""Host-only Unix socket: refresh one fixed, operator-approved RDP sync."""
import argparse
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import socket
import socketserver
import stat
import struct
import subprocess
import threading
import time
import uuid

spec = importlib.util.spec_from_file_location("rdp_sync", Path(__file__).with_name("rdp-sync.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def public_status(status):
    state = "current" if status.get("state") == "ready" else "pending" if status.get("state") == "running" else "failed"
    result = {"state": state, "checkedAt": status.get("lastSuccess")}
    for key in ("documents", "unreadable"):
        value = status.get(key)
        if type(value) is int and 0 <= value <= 10000:
            result[key] = value
    return result


class Coordinator:
    def __init__(self, manifest, run=None, wait_seconds=175):
        self.manifest = manifest
        self.run = run or self.run_service
        self.wait_seconds = wait_seconds
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.lock = threading.Lock()
        self.future = None
        self.last_finished = 0.0

    def status(self):
        return sync.read_json(self.manifest["state"] / "status.json", {})

    def run_service(self):
        # Fixed unit; callers can never select commands, paths or source roots.
        for audience in self.manifest["publications"]:
            sync.scope_directory(self.manifest, audience)
        result = subprocess.run(["/usr/bin/systemctl", "start", "aibrain-arnall-sync.service"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1815)
        status = self.status()
        if result.returncode != 0 and status.get("state") == "ready":
            return {"state": "failed", "checkedAt": status.get("lastSuccess")}
        return public_status(status)

    def refresh(self):
        with self.lock:
            if self.future is not None and not self.future.done():
                future = self.future
            else:
                status = self.status()
                try:
                    age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(status["lastSuccess"])).total_seconds()
                except (KeyError, ValueError, TypeError):
                    age = float("inf")
                # Coalesce simultaneous requests and reuse a check for 30 seconds.
                if status.get("state") == "ready" and 0 <= age <= 30:
                    return public_status(status)
                # Bound repeated failures without turning a denied policy into a retry storm.
                if self.future is not None and time.monotonic() - self.last_finished < 15:
                    future = self.future
                else:
                    future = self.future = self.executor.submit(self.run_recorded)
        try:
            return dict(future.result(timeout=self.wait_seconds))
        except FutureTimeout:
            return {"state": "pending", "checkedAt": self.status().get("lastSuccess")}
        except Exception:
            with self.lock:
                self.last_finished = time.monotonic()
            return {"state": "failed", "checkedAt": self.status().get("lastSuccess")}

    def run_recorded(self):
        try:
            return self.run()
        finally:
            with self.lock:
                self.last_finished = time.monotonic()


def validate_request(value, manifest):
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "operation", "requestId", "installationId", "connectionId"}:
        return False
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or value["operation"] != "refresh" or value["installationId"] != manifest["installationId"] or value["connectionId"] != manifest["connectionId"]:
        return False
    try:
        return str(uuid.UUID(value["requestId"])) == value["requestId"]
    except (ValueError, TypeError, AttributeError):
        return False


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, path, coordinator):
        self.coordinator = coordinator
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(str(path), Handler)

    def verify_request(self, request, _):
        _, uid, _ = struct.unpack("3i", request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        return uid == self.coordinator.manifest["appUid"]


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        if not self.server.slots.acquire(blocking=False):
            return
        try:
            self.connection.settimeout(5)
            line = self.rfile.readline(1025)
            if len(line) > 1024 or not line.endswith(b"\n"):
                return
            value = json.loads(line)
            manifest = self.server.coordinator.manifest
            if not validate_request(value, manifest):
                return
            self.connection.settimeout(180)
            result = self.server.coordinator.refresh()
            result.update(requestId=value["requestId"], installationId=manifest["installationId"], connectionId=manifest["connectionId"])
            self.wfile.write((json.dumps(result) + "\n").encode())
            print(json.dumps({"event": "document_sync_requested", "requestId": value["requestId"], "state": result["state"]}), flush=True)
        except (ValueError, OSError):
            pass
        finally:
            self.server.slots.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()
    sync.require(os.geteuid() == 0, "HOST_OPERATOR_REQUIRED")
    os.umask(0o077)
    manifest = sync.load_manifest(args.manifest)
    # This unit has one installation and one sync service, fixed by the operator.
    sync.require(manifest["connectionId"] == "arnall" and manifest["installationId"] == "company-qa", "UNSUPPORTED_BROKER_BINDING")
    sync.require(bool(manifest["publications"]), "NO_AUTHORIZED_PUBLICATION")
    directory = Path(manifest["dataRootHost"]) / "locks" / "document-sync"
    directory.mkdir(mode=0o750, exist_ok=True)
    sync.secure_dir(directory)
    os.chown(directory, 0, manifest["appGid"])
    descriptor = directory / (manifest["connectionId"] + ".json")
    sync.atomic_json(descriptor, {"schemaVersion": 1, "connectionId": manifest["connectionId"],
                                  "installationId": manifest["installationId"], "publications": manifest["publications"]})
    os.chown(descriptor, 0, manifest["appGid"])
    os.chmod(descriptor, 0o440)
    address = directory / (manifest["connectionId"] + ".sock")
    if address.exists() or address.is_symlink():
        info = address.lstat()
        sync.require(stat.S_ISSOCK(info.st_mode) and info.st_uid == 0, "UNSAFE_BROKER_SOCKET")
        probe = socket.socket(socket.AF_UNIX)
        try:
            probe.connect(str(address))
        except ConnectionRefusedError:
            address.unlink()
        else:
            raise ValueError("BROKER_ALREADY_RUNNING")
        finally:
            probe.close()
    with Server(address, Coordinator(manifest)) as server:
        os.chown(address, 0, manifest["appGid"])
        os.chmod(address, 0o660)
        server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
