#!/usr/bin/env python3
"""Installation-bound Unix broker for read-only Windows file queries."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import socketserver
import stat
import struct
import subprocess
import sys
import threading
import uuid

spec = importlib.util.spec_from_file_location("server_files", Path(__file__).with_name("rdp-server-files.py"))
files = importlib.util.module_from_spec(spec)
spec.loader.exec_module(files)
sync = files.sync
map_spec = importlib.util.spec_from_file_location("server_map", Path(__file__).with_name("knowledge-map.py"))
server_map = importlib.util.module_from_spec(map_spec)
map_spec.loader.exec_module(server_map)


def folder_module():
    spec = importlib.util.spec_from_file_location('folder_inventory', Path(__file__).with_name('knowledge-folder-inventory.py'))
    folder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(folder)
    return folder


def validate_request(value, manifest):
    try:
        if not isinstance(value, dict) or set(value) != {"schemaVersion", "operation", "requestId", "installationId", "connectionId", "input"}:
            return False
        if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or value["installationId"] != manifest["installationId"] or value["connectionId"] != manifest["connectionId"]:
            return False
        if str(uuid.UUID(value["requestId"])) != value["requestId"] or not isinstance(value["input"], dict):
            return False
        args = value["input"]
        if value["operation"] == "search" and set(args) == {"query", "limit"}:
            request = files.query_request(args["query"], args["limit"])
            if request.get("source"):
                files.rdp.select_root(request["source"], manifest["sourceRoots"])
            return True
        if value["operation"] == "inventory" and set(args) == {"path", "offset"}:
            source, _ = files.source_path(manifest["connectionId"], args["path"])
            files.rdp.select_root(source, manifest["sourceRoots"])
            return '?' not in args['path'] and type(args['offset']) is int and 0 <= args['offset'] <= 500_000
        if value["operation"] == "read" and set(args) == {"path"}:
            source, _ = files.source_path(manifest["connectionId"], args["path"])
            files.rdp.select_root(source, manifest["sourceRoots"])
            return True
        return False
    except (ValueError, TypeError, AttributeError):
        return False


def execute(manifest, value, cached_only=False):
    sync.require(validate_request(value, manifest), "INVALID_SERVER_FILE_REQUEST")
    # Revalidate publication ownership before every operation, not just startup.
    for audience in manifest["publications"]:
        sync.scope_directory(manifest, audience)
    try:
        if value['operation'] == 'inventory':
            if cached_only:
                result = server_map.folder_inventory(manifest, files=files, **value['input'])
                return result if result and (result['enumerationComplete'] or not result['directories'].get('pending')) else None
            # Lazy import keeps older installations' search/read independent.
            return folder_module().execute(manifest, **value['input'])
        if value["operation"] == "search":
            cached = server_map.cached_search(manifest, files=files, **value["input"])
            if cached is not None:
                return cached
            if cached_only:
                return None
            with folder_module().interactive_access(manifest):
                return files.search(manifest, **value["input"])
        if cached_only:
            return None
        with folder_module().interactive_access(manifest):
            return files.read(manifest, **value["input"])
    except Exception as error:
        code = 'SERVER_FILES_BUSY' if isinstance(error, BlockingIOError) else str(error) if isinstance(error, ValueError) else "SERVER_FILES_UNAVAILABLE"
        if code not in {"SERVER_FILES_BUSY", "WINDOWS_PATH_UNAVAILABLE", "SERVER_FORMAT_NOT_READABLE", "SERVER_TEXT_UNAVAILABLE", "SERVER_PART_UNAVAILABLE", "RDP_DRIVE_REDIRECTION_DISABLED"}:
            code = "SERVER_FILES_UNAVAILABLE"
        warnings = {'SERVER_FILES_BUSY': 'La conexión está ocupada. Reintenta la consulta concreta; no significa que la carpeta no exista.',
                    'WINDOWS_PATH_UNAVAILABLE': 'Windows no ha permitido consultar esta ruta concreta. No acredita una caída del servidor ni ausencia global. Comprueba las carpetas observadas en el padre.'}
        return {"available": False, "error": code, "warning": warnings.get(code, "No se ha podido consultar esta ubicación. No demuestra que no exista; no se ha modificado el servidor.")}


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, manifest, manifest_path):
        self.manifest, self.manifest_path = manifest, manifest_path
        self.slot = threading.BoundedSemaphore(1)
        self.lookup_slots = threading.BoundedSemaphore(2)
        super().__init__(str(address), Handler)

    def verify_request(self, request, _):
        _, uid, _ = struct.unpack("3i", request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        return uid == self.manifest["appUid"]

    def dispatch(self, value):
        # Cached metadata never waits behind a Windows read. Separate, bounded
        # child processes retain the same scope validation and response limit.
        busy = {"available": False, "error": "SERVER_FILES_BUSY", "warning": "El servidor está atendiendo otra consulta. Vuelve a intentarlo en unos segundos."}
        if value['operation'] in ('search', 'inventory'):
            if not self.lookup_slots.acquire(blocking=False):
                return busy
            try:
                result = self.run(value, cached_only=True)
                if result is not None:
                    return result
            finally:
                self.lookup_slots.release()
        if not self.slot.acquire(blocking=False):
            return busy
        try:
            return self.run(value)
        finally:
            self.slot.release()

    def run(self, value, cached_only=False):
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--manifest", self.manifest_path, "--execute"] + (["--cached-only"] if cached_only else []),
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            output, _ = child.communicate(json.dumps(value).encode(), timeout=20 if cached_only else 210)
            if child.returncode or len(output) > 256 * 1024:
                raise ValueError("SERVER_FILES_UNAVAILABLE")
            return json.loads(output)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            return {"available": False, "error": "SERVER_FILES_TIMEOUT"}


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            self.connection.settimeout(5)
            line = self.rfile.readline(2049)
            if len(line) > 2048 or not line.endswith(b"\n"):
                return
            value = json.loads(line)
            if not validate_request(value, self.server.manifest):
                return
            self.connection.settimeout(220)
            result = self.server.dispatch(value)
            result.update(requestId=value["requestId"], installationId=value["installationId"], connectionId=value["connectionId"])
            self.wfile.write((json.dumps(result, ensure_ascii=False) + "\n").encode())
            print(json.dumps({"event": "server_files_requested", "requestId": value["requestId"], "operation": value["operation"], "available": result["available"]}), flush=True)
        except (ValueError, OSError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--cached-only", action="store_true")
    args = parser.parse_args()
    sync.require(os.geteuid() == 0, "HOST_OPERATOR_REQUIRED")
    os.umask(0o077)
    manifest = sync.load_manifest(args.manifest)
    # This endpoint exposes the company's server account only to its existing
    # company reader scope. It never converts a private/department grant.
    sync.require(manifest["publications"] == [{"scope": "company", "scopeId": None}], "COMPANY_READER_SCOPE_REQUIRED")
    if args.execute:
        value = json.loads(sys.stdin.buffer.read(2049))
        print(json.dumps(execute(manifest, value, cached_only=args.cached_only), ensure_ascii=False))
        return
    directory = Path(manifest["dataRootHost"]) / "locks" / "server-files"
    directory.mkdir(mode=0o750, exist_ok=True)
    sync.secure_dir(directory)
    os.chown(directory, 0, manifest["appGid"])
    descriptor = directory / (manifest["connectionId"] + ".json")
    sync.atomic_json(descriptor, {"schemaVersion": 1, "connectionId": manifest["connectionId"],
                                "installationId": manifest["installationId"], "scope": "company", "mode": "read-only"})
    os.chown(descriptor, 0, manifest["appGid"])
    os.chmod(descriptor, 0o440)
    address = directory / (manifest["connectionId"] + ".sock")
    if address.exists() or address.is_symlink():
        info = address.lstat()
        sync.require(stat.S_ISSOCK(info.st_mode) and info.st_uid == 0, "UNSAFE_BROKER_SOCKET")
        with socket.socket(socket.AF_UNIX) as probe:
            try:
                probe.connect(str(address))
            except ConnectionRefusedError:
                address.unlink()
            else:
                raise ValueError("BROKER_ALREADY_RUNNING")
    with Server(address, manifest, str(Path(args.manifest).resolve())) as server:
        os.chown(address, 0, manifest["appGid"])
        os.chmod(address, 0o660)
        server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
