#!/usr/bin/env python3
"""Private, verified knowledge snapshots and restore into a new gated directory.

SQLite's backup API captures committed state; immutable originals are verified
by their content address. No running database file or ephemeral lock is copied.
This creates local snapshots, not off-host encrypted replication.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
import uuid

spec=importlib.util.spec_from_file_location("publication",Path(__file__).with_name("knowledge-publish.py"))
publication=importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)
catalogue,require=publication.catalogue,publication.require


def private_directory(path,create=False):
    path=Path(path)
    require(path.is_absolute(),"ABSOLUTE_DIRECTORY_REQUIRED")
    for parent in [*reversed(path.parents),path]:
        if parent.exists() or parent.is_symlink():
            require(parent.is_dir() and not parent.is_symlink(),"UNSAFE_BACKUP_PATH")
    if create:
        path.mkdir(mode=0o700)
    info=path.stat()
    require(info.st_uid==os.geteuid() and not info.st_mode&0o077,"PRIVATE_BACKUP_REQUIRED")
    return path


def regular(path):
    publication.ingest.regular(path)


def digest(path):
    regular(path)
    checksum=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):
            checksum.update(block)
    return checksum.hexdigest()


def private_parents(path):
    # mkdir(parents=True, mode=0700) applies the mode only to the leaf. Library
    # callers may have a permissive umask, so create each missing level itself.
    missing=[]
    parent=Path(path)
    while not parent.exists():
        require(not parent.is_symlink(),"UNSAFE_BACKUP_PATH")
        missing.append(parent)
        parent=parent.parent
    private_directory(parent)
    for directory in reversed(missing):
        directory.mkdir(mode=0o700)
    private_directory(path)


def copy_checked(source,target,expected=None):
    regular(source)
    private_parents(target.parent)
    with source.open('rb') as src, target.open('xb') as dst:
        os.chmod(target,0o600)
        shutil.copyfileobj(src,dst,1024*1024)
        dst.flush()
        os.fsync(dst.fileno())
    checksum=digest(target)
    require(checksum==digest(source) and (expected is None or checksum==expected),"BACKUP_SOURCE_CHANGED")
    return checksum


def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def allowed_path(value):
    return isinstance(value,str) and bool(re.fullmatch(
        r"operator/catalogue\.sqlite3|operator/objects/[a-f0-9]{64}/original|partitions/[a-f0-9]{32}/(?:catalogue\.sqlite3|audience\.json)|bindings\.json",value))


def verify(snapshot,installation):
    snapshot=private_directory(snapshot)
    regular(snapshot/"manifest.json")
    require((snapshot/"manifest.json").stat().st_size<=16*1024*1024,"BACKUP_MANIFEST_TOO_LARGE")
    manifest=json.loads((snapshot/"manifest.json").read_text())
    require(isinstance(manifest,dict) and manifest.get("schemaVersion")==1 and manifest.get("installationId")==installation
            and isinstance(manifest.get("files"),list) and 1<=len(manifest["files"])<=100000,"INVALID_BACKUP_MANIFEST")
    paths=set()
    for entry in manifest["files"]:
        require(isinstance(entry,dict) and set(entry)=={"path","bytes","sha256"} and allowed_path(entry["path"])
                and entry["path"] not in paths and type(entry["bytes"]) is int and entry["bytes"]>=0
                and isinstance(entry["sha256"],str) and re.fullmatch(r"[a-f0-9]{64}",entry["sha256"]),"INVALID_BACKUP_ENTRY")
        paths.add(entry["path"])
        file=snapshot/entry["path"]
        private_directory(file.parent)
        require(digest(file)==entry["sha256"] and file.stat().st_size==entry["bytes"],"BACKUP_CHECKSUM_MISMATCH")
    actual={p.relative_to(snapshot).as_posix() for p in snapshot.rglob('*') if not p.is_dir()}
    require(actual==paths|{"manifest.json"},"BACKUP_UNEXPECTED_FILES")
    require("operator/catalogue.sqlite3" in paths and "bindings.json" in paths,"BACKUP_COMPONENT_MISSING")
    bindings=json.loads((snapshot/"bindings.json").read_text())
    publication.validate_bindings(bindings,installation)
    checksums={entry["path"]:entry["sha256"] for entry in manifest["files"]}
    for name in sorted(p for p in paths if p.endswith("catalogue.sqlite3")):
        directory=snapshot/Path(name).parent
        if name.startswith("operator/"):
            audience="operator"
        else:
            require(str(Path(name).parent/"audience.json") in paths,"BACKUP_AUDIENCE_MISSING")
            value=json.loads((directory/"audience.json").read_text())
            require(publication.partition_id(value)==directory.name,"PARTITION_BINDING_MISMATCH")
            audience=publication.audience_key(value)
        store=catalogue.Catalogue(directory,installation,audience,readonly=True)
        try:
            require(store.db.execute("PRAGMA integrity_check").fetchone()[0]=='ok',"BACKUP_DATABASE_CORRUPT")
            require(not store.db.execute("PRAGMA foreign_key_check").fetchall(),"BACKUP_FOREIGN_KEY_INVALID")
            for row in store.db.execute("SELECT sha256 FROM versions UNION SELECT sha256 FROM documents WHERE state='indexed'"):
                require(row[0] is not None and f"operator/objects/{row[0]}/original" in paths,"BACKUP_ORIGINAL_MISSING")
                require(checksums[f"operator/objects/{row[0]}/original"]==row[0],"BACKUP_ORIGINAL_HASH_MISMATCH")
        finally:
            store.close()
    return manifest


def create(root,installation,backups,bindings):
    root,backups=private_directory(root),private_directory(backups)
    require(not backups.is_relative_to(root) and not root.is_relative_to(backups),"BACKUP_SOURCE_OVERLAP")
    publication.validate_bindings(bindings,installation)
    required=sum(p.stat().st_size for p in root.rglob('*') if p.is_file() and not p.is_symlink())
    require(shutil.disk_usage(backups).free>=required+512*1024*1024,"BACKUP_SPACE_UNAVAILABLE")
    pending=Path(tempfile.mkdtemp(prefix=".pending-",dir=backups))
    identifier=str(uuid.uuid4())
    try:
        components=[(root/"operator","operator")]
        partitions=root/"partitions"
        if partitions.exists():
            private_directory(partitions)
            for directory in sorted(partitions.iterdir()):
                private_directory(directory)
                regular(directory/"audience.json")
                value=json.loads((directory/"audience.json").read_text())
                require(publication.partition_id(value)==directory.name,"PARTITION_BINDING_MISMATCH")
                components.append((directory,publication.audience_key(value)))
        originals=set()
        for directory,audience in components:
            target=pending/directory.relative_to(root)
            private_parents(target)
            store=catalogue.Catalogue(directory,installation,audience,readonly=True)
            database=target/"catalogue.sqlite3"
            fd=os.open(database,os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600)
            os.close(fd)
            output=sqlite3.connect(database)
            try:
                store.db.backup(output)
                output.commit()
                originals.update(row[0] for row in output.execute("SELECT sha256 FROM versions UNION SELECT sha256 FROM documents WHERE state='indexed'"))
            finally:
                output.close()
                store.close()
            with database.open('rb') as handle:
                os.fsync(handle.fileno())
            if audience!='operator':
                copy_checked(directory/"audience.json",target/"audience.json")
        for checksum in sorted(originals):
            require(isinstance(checksum,str) and re.fullmatch(r"[a-f0-9]{64}",checksum),"INVALID_ORIGINAL_HASH")
            relative=Path("operator/objects")/checksum/"original"
            private_directory((root/relative).parent)
            copy_checked(root/relative,pending/relative,checksum)
        publication.files.sync.atomic_json(pending/"bindings.json",bindings)
        files=[{"path":p.relative_to(pending).as_posix(),"bytes":p.stat().st_size,"sha256":digest(p)}
               for p in sorted(pending.rglob('*')) if p.is_file()]
        manifest={"schemaVersion":1,"backupId":identifier,"installationId":installation,"createdAt":catalogue.now(),"files":files,
                  "scopeConsistency":"Committed per-database snapshots; restore requires fresh policy and source reconciliation."}
        publication.files.sync.atomic_json(pending/"manifest.json",manifest)
        verify(pending,installation)
        for directory in sorted([p for p in pending.rglob('*') if p.is_dir()],key=lambda p:len(p.parts),reverse=True):
            sync_directory(directory)
        sync_directory(pending)
        destination=backups/identifier
        pending.rename(destination)
        sync_directory(backups)
        return {"backupId":identifier,"snapshot":str(destination),"files":len(files),"bytes":sum(f["bytes"] for f in files),"verified":True}
    except BaseException:
        # Partial data remain private for inspection, never presented as a
        # completed snapshot. No source tree or prior backup is removed.
        raise


def restore(snapshot,installation,destination,live_root):
    manifest=verify(snapshot,installation)
    snapshot,live_root=Path(snapshot),private_directory(live_root)
    destination=Path(destination)
    require(destination.is_absolute() and not destination.exists() and not destination.is_symlink(),"RESTORE_DESTINATION_EXISTS")
    parent=private_directory(destination.parent)
    require(not destination.is_relative_to(live_root) and not live_root.is_relative_to(destination)
            and not destination.is_relative_to(snapshot) and not snapshot.is_relative_to(destination),"RESTORE_SOURCE_OVERLAP")
    require(shutil.disk_usage(parent).free>=sum(f["bytes"] for f in manifest["files"])+512*1024*1024,"RESTORE_SPACE_UNAVAILABLE")
    staging=Path(tempfile.mkdtemp(prefix=".restore-pending-",dir=parent))
    for entry in manifest["files"]:
        copy_checked(snapshot/entry["path"],staging/entry["path"],entry["sha256"])
    # Current external credentials/scope markers are never restored. The copied
    # policy is evidence only; all employee reads remain gated by this marker.
    publication.files.sync.atomic_json(staging/"restore-requires-reconciliation.json",{
        "installationId":installation,"backupId":manifest["backupId"],"restoredAt":catalogue.now(),
        "reason":"Revalidate current publication policy and each source before enabling employee access."})
    for directory in sorted([p for p in staging.rglob('*') if p.is_dir()],key=lambda p:len(p.parts),reverse=True):
        sync_directory(directory)
    sync_directory(staging)
    require(not destination.exists() and not destination.is_symlink(),"RESTORE_DESTINATION_EXISTS")
    staging.rename(destination)
    sync_directory(parent)
    return {"restored":True,"destination":str(destination),"backupId":manifest["backupId"],"employeeAccessEnabled":False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation",choices=["create","verify","restore"])
    parser.add_argument("--manifest",required=True)
    parser.add_argument("--bindings")
    parser.add_argument("--backups")
    parser.add_argument("--snapshot")
    parser.add_argument("--destination")
    args=parser.parse_args()
    require(os.geteuid()==0,"HOST_OPERATOR_REQUIRED")
    os.umask(0o077)
    manifest=publication.files.sync.load_manifest(args.manifest)
    installation=manifest["installationId"]
    root=Path("/var/lib/aibrain/knowledge")/installation
    if args.operation=='create':
        require(args.bindings and args.backups,"BACKUP_ARGUMENT_REQUIRED")
        bindings=json.loads(publication.files.rdp.private_file(args.bindings).read_text())
        result=create(root,installation,Path(args.backups),bindings)
    elif args.operation=='verify':
        require(args.snapshot,"BACKUP_ARGUMENT_REQUIRED")
        result={"verified":True,"backupId":verify(Path(args.snapshot),installation)["backupId"]}
    else:
        require(args.snapshot and args.destination,"BACKUP_ARGUMENT_REQUIRED")
        result=restore(Path(args.snapshot),installation,Path(args.destination),root)
    print(json.dumps(result))


if __name__=='__main__':
    main()
