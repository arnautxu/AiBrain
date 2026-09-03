#!/usr/bin/env python3
"""Resumable private server inventory over the existing read-only RDP route."""
import argparse
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import time


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


catalogue = module("knowledge_catalogue", "knowledge-catalogue.py")
files = module("knowledge_server_files", "rdp-server-files.py")
require = catalogue.require


def source_failure(error):
    """Persist a fixed diagnostic code, never source paths or raw exceptions."""
    if isinstance(error, subprocess.TimeoutExpired):
        return "SOURCE_TIMEOUT"
    if isinstance(error, subprocess.CalledProcessError):
        return "SOURCE_PROCESS_FAILED"
    if isinstance(error, ValueError):
        return {
            "WINDOWS_PATH_UNAVAILABLE": "SOURCE_PATH_UNAVAILABLE",
            "SERVER_QUERY_TOO_LARGE": "SOURCE_COMMAND_TOO_LARGE",
            "RDP_CONNECTION_LOST": "SOURCE_CONNECTION_LOST",
            "No matching RDP readback; source access was not confirmed": "SOURCE_READBACK_UNCONFIRMED",
            "Keyboard pipe timeout": "SOURCE_CONNECTION_FAILED",
            "Display startup timeout": "SOURCE_CONNECTION_FAILED",
            "RDP session startup failed": "SOURCE_CONNECTION_FAILED",
            "RDP window unavailable": "SOURCE_CONNECTION_FAILED",
        }.get(str(error), "INVALID_SOURCE_PAGE")
    return "INVALID_SOURCE_PAGE" if isinstance(error, (KeyError, TypeError, AttributeError)) else "SOURCE_UNAVAILABLE"


def rescan_due(scan,interval_seconds,at=None):
    require(type(interval_seconds) is int and (interval_seconds==0 or 900<=interval_seconds<=30*86400),"INVALID_RESCAN_INTERVAL")
    if not scan or scan["state"]=='running' or not interval_seconds or not scan.get("finished"):
        return False
    finished=dt.datetime.fromisoformat(scan["finished"].replace('Z','+00:00'))
    require(finished.tzinfo is not None,"INVALID_SCAN_TIME")
    return ((at or dt.datetime.now(dt.timezone.utc))-finished).total_seconds()>=interval_seconds


def discover(manifest, run=files.browse):
    result = run(manifest, {"mode": "drives", "limit": 50, "offset": 0})
    require(result.get("ok") is True and result.get("truncated") is False and
            not result.get("denied") and isinstance(result.get("entries"), list), "INCOMPLETE_DRIVE_DISCOVERY")
    roots = []
    for item in result["entries"]:
        source, _ = files.rdp.select_root(item["source"], manifest["sourceRoots"])
        require(len(source) == 3 and item["directory"] is True, "INVALID_DRIVE_DISCOVERY")
        roots.append(source)
    require(0 < len(roots) <= 26 and len(set(roots)) == len(roots), "INVALID_DRIVE_DISCOVERY")
    return roots


def process_page(store, manifest, scan, row, run=files.browse):
    """One source request per durable page; process death cannot lose its cursor."""
    files.rdp.select_root(row["source"], manifest["sourceRoots"])
    result = run(manifest, {"mode": "list", "source": row["source"], "offset": row["offset"], "limit": 50})
    require(result.get("ok") is True and isinstance(result.get("entries"), list) and
            len(result["entries"]) <= 50 and type(result.get("truncated")) is bool, "INVALID_SOURCE_PAGE")
    next_offset = result.get("nextOffset")
    require((type(next_offset) is int and next_offset == row["offset"] + len(result["entries"]) and
             len(result["entries"]) > 0) if result["truncated"] else next_offset is None, "INVALID_SOURCE_PAGE")
    entries, withheld = [], 0
    for item in result["entries"]:
        # Apply fresh-read secret/path exclusions before any persistence.
        if item.get("reparse"):
            withheld += 1
            continue
        try:
            files.rdp.select_root(item["source"], manifest["sourceRoots"])
        except ValueError:
            withheld += 1
            continue
        entries.append(item)
    store.record_page(scan, row["source"], row["offset"], entries, next_offset,
                      limited=bool(result.get("denied") or withheld), transport_count=len(result["entries"]))


def run_batch(store, manifest, scan, max_pages=10, seconds=300, run=files.browse, pause_seconds=0, priority_roots=None):
    require(type(max_pages) is int and 1 <= max_pages <= 1000 and 1 <= seconds <= 3600, "INVALID_BATCH_LIMIT")
    started, attempted, deferred = time.monotonic(), 0, set()
    while attempted < max_pages and time.monotonic() - started < seconds:
        if attempted and pause_seconds:
            time.sleep(min(pause_seconds,5))
        if time.monotonic() - started >= seconds:
            break
        row = store.next_directory(scan,priority_roots,deferred)
        if row is None:
            if store.next_directory(scan,priority_roots) is not None:
                return {**store.coverage(scan),"paused":"SOURCE_RETRY_PENDING"}
            return store.finish_scan(scan)
        attempted += 1
        try:
            process_page(store, manifest, scan, row, run)
        except BlockingIOError:
            return {**store.coverage(scan),"paused":"SOURCE_BUSY"}
        except Exception as error:
            if isinstance(error, ValueError) and str(error) == "RDP_DRIVE_REDIRECTION_DISABLED":
                store.directory_failed(scan,row["source"],"SOURCE_POLICY_DENIED")
                raise
            code = source_failure(error)
            store.directory_failed(scan,row["source"],code)
            if code in {"SOURCE_PATH_UNAVAILABLE", "SOURCE_COMMAND_TOO_LARGE"}:
                # A local path failure must not starve other folders. Only the
                # next scheduled batch can retry this path; every attempt counts
                # against the existing request budget, including failures.
                deferred.add(row["source_key"])
                continue
            # Transport, malformed responses and unknown failures end the batch.
            return store.coverage(scan)
    return store.coverage(scan)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Existing private server-files manifest")
    parser.add_argument("--max-pages",type=int,default=10)
    parser.add_argument("--seconds",type=int,default=300)
    parser.add_argument("--status",action="store_true")
    parser.add_argument("--new-scan",action="store_true")
    parser.add_argument("--rescan-after",type=int,default=0,help="Start a new traversal this many seconds after a finished scan; 0 disables automatic rescanning")
    parser.add_argument("--priority-manifest",help="Existing bounded mirror whose business folders should be inventoried first")
    args = parser.parse_args()
    require(os.geteuid() == 0, "HOST_OPERATOR_REQUIRED")
    os.umask(0o077)
    manifest = files.sync.load_manifest(args.manifest)
    root = Path("/var/lib/aibrain/knowledge") / manifest["installationId"] / "operator"
    store = catalogue.Catalogue(root,manifest["installationId"],"operator",manifest["maxFileBytes"])
    if args.status:
        try:
            row = store.db.execute("SELECT * FROM scans ORDER BY rowid DESC LIMIT 1").fetchone()
            print(json.dumps(store.coverage(row["id"]) if row else {"state":"not_started"}))
        finally:
            store.close()
        return
    fd = os.open(root / "inventory.lock",os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0 and not info.st_mode & 0o077, "UNSAFE_LOCK")
        try:
            fcntl.flock(fd,fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"state":"waiting","reason":"CATALOGUE_BUSY"}))
            return
        row = store.db.execute("SELECT * FROM scans ORDER BY rowid DESC LIMIT 1").fetchone()
        if row and row["state"] == "running":
            require(not args.new_scan,"SCAN_ALREADY_RUNNING")
            scan = row["id"]
        elif row and not args.new_scan and not rescan_due(dict(row),args.rescan_after):
            print(json.dumps(store.coverage(row["id"])))
            return
        else:
            try:
                scan = store.start_scan(discover(manifest))
            except BlockingIOError:
                print(json.dumps({"state":"waiting","reason":"SOURCE_BUSY"}))
                return
            except (ValueError,OSError):
                with store.write():
                    store.db.execute("INSERT INTO issues(recorded,code) VALUES(?,?)",(catalogue.now(),"DRIVE_DISCOVERY_UNAVAILABLE"))
                print(json.dumps({"state":"waiting","reason":"DRIVE_DISCOVERY_UNAVAILABLE"}))
                return
        priority=files.sync.load_manifest(args.priority_manifest)["sourceRoots"] if args.priority_manifest else None
        if priority:
            for source in priority:
                files.rdp.select_root(source,manifest["sourceRoots"])
        print(json.dumps(run_batch(store,manifest,scan,args.max_pages,args.seconds,pause_seconds=2,priority_roots=priority)))
    finally:
        os.close(fd)
        store.close()


if __name__ == "__main__":
    main()
