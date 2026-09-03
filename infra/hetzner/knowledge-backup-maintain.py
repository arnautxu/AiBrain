#!/usr/bin/env python3
"""Bounded local knowledge snapshots with verified, conservative retention."""
import argparse
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import uuid

spec=importlib.util.spec_from_file_location('backup',Path(__file__).with_name('knowledge-backup.py'))
backup=importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
require=backup.require


def tree_bytes(directory):
    total=0
    for entry in directory.rglob('*'):
        require(not entry.is_symlink(),'UNSAFE_BACKUP_PATH')
        if entry.is_file():
            backup.regular(entry)
            total+=entry.stat().st_size
        else:
            backup.private_directory(entry)
    return total


def snapshots(directory,installation):
    result=[]
    for path in directory.iterdir():
        # Locks, failure receipts and incomplete snapshots are counted toward
        # capacity but are never selected for automatic removal.
        if path.name.startswith('.') or path.name=='maintenance.json':
            continue
        require(str(uuid.UUID(path.name))==path.name,'UNEXPECTED_BACKUP_ENTRY')
        manifest=backup.verify(path,installation)
        require(manifest.get('backupId')==path.name,'BACKUP_ID_MISMATCH')
        created=dt.datetime.fromisoformat(manifest['createdAt'].replace('Z','+00:00'))
        require(created.tzinfo is not None,'INVALID_BACKUP_TIMESTAMP')
        result.append((created,path))
    return sorted(result,reverse=True)


def prune(directory,installation,keep,min_age_seconds,at):
    candidates=snapshots(directory,installation)
    removed=[]
    for created,path in candidates[keep:]:
        if (at-created).total_seconds()<min_age_seconds:
            continue
        # Revalidate at deletion, never use a stale list or remove live data.
        backup.verify(path,installation)
        shutil.rmtree(path)
        removed.append(path.name)
    if removed:
        backup.sync_directory(directory)
    return removed


def maintain(root,installation,directory,bindings,keep=7,min_age_seconds=604800,max_bytes=8*1024**3,at=None):
    require(type(keep) is int and 2<=keep<=365 and type(min_age_seconds) is int and min_age_seconds>=86400
            and type(max_bytes) is int and max_bytes>=1024*1024,'INVALID_RETENTION_POLICY')
    root,directory=backup.private_directory(root),backup.private_directory(directory)
    require(not root.is_relative_to(directory) and not directory.is_relative_to(root),'BACKUP_SOURCE_OVERLAP')
    backup.publication.validate_bindings(bindings,installation)
    fd=os.open(directory/'.maintenance.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        backup.regular(directory/'.maintenance.lock')
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            return {'state':'waiting','reason':'BACKUP_BUSY'}
        current=at or dt.datetime.now(dt.timezone.utc)
        require(current.tzinfo is not None,'INVALID_BACKUP_TIMESTAMP')
        # Validate the entire tree before retention; unexpected data fail closed.
        tree_bytes(directory)
        removed=prune(directory,installation,keep,min_age_seconds,current)
        used=tree_bytes(directory)
        # Conservative upper bound includes caches and SQLite sidecars. Keep a
        # manifest margin, and do not claim space savings before a verified copy.
        estimate=tree_bytes(root)+1024*1024
        require(used+estimate<=max_bytes,'BACKUP_CAPACITY_LIMIT')
        result=backup.create(root,installation,directory,bindings)
        removed+=prune(directory,installation,keep,min_age_seconds,current)
        result.update(state='completed',removed=removed,retained=len(snapshots(directory,installation)),
                      maxBytes=max_bytes,usedBytes=tree_bytes(directory),replicatedOffHost=False)
        backup.publication.files.sync.atomic_json(directory/'maintenance.json',
            {**result,'installationId':installation,'checkedAt':backup.catalogue.now()})
        return result
    finally:
        os.close(fd)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--bindings',required=True)
    parser.add_argument('--backups',required=True)
    parser.add_argument('--keep',type=int,default=7)
    parser.add_argument('--min-age-seconds',type=int,default=604800)
    parser.add_argument('--max-bytes',type=int,default=8*1024**3)
    args=parser.parse_args()
    require(os.geteuid()==0,'HOST_OPERATOR_REQUIRED')
    os.umask(0o077)
    manifest=backup.publication.files.sync.load_manifest(args.manifest)
    installation=manifest['installationId']
    bindings=json.loads(backup.publication.files.rdp.private_file(args.bindings).read_text())
    result=maintain(Path('/var/lib/aibrain/knowledge')/installation,installation,Path(args.backups),bindings,
                    args.keep,args.min_age_seconds,args.max_bytes)
    print(json.dumps(result))


if __name__=='__main__':
    main()
