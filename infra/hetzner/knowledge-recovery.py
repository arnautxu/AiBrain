#!/usr/bin/env python3
"""Reconcile an isolated restore before explicitly opening its reader gate.

Never switches the live root, restores credentials, or modifies Windows sources.
"""
import argparse
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import time


def module(name,filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


backup=module('recovery_backup','knowledge-backup.py')
source=module('recovery_source','knowledge-source-check.py')
publication=backup.publication
catalogue,files,require=publication.catalogue,publication.files,publication.require
GATE='restore-requires-reconciliation.json'
PROGRESS='recovery-progress.json'


def private_json(path):
    backup.regular(path)
    require(path.stat().st_size<=1024*1024,'RECOVERY_METADATA_TOO_LARGE')
    return json.loads(path.read_text())


def policy_digest(manifest,bindings):
    publication.validate_bindings(bindings,manifest['installationId'])
    if 'recoveryBindingsFile' in manifest:
        require(json.loads(files.rdp.private_file(manifest['recoveryBindingsFile']).read_text())==bindings,'RECOVERY_POLICY_CHANGED')
    value={'bindings':bindings,'sourceRoots':manifest['sourceRoots'],'maxFileBytes':manifest['maxFileBytes']}
    # CLI manifests are host-validated. Fingerprint credential/access changes
    # without persisting or printing their contents in recovery receipts.
    for key in ('connectionConfig','accessManifest'):
        value[key]=hashlib.sha256(files.rdp.private_file(manifest[key]).read_bytes()).hexdigest()
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


@contextlib.contextmanager
def session(root,live_root,manifest,bindings,check_scope):
    root,live_root=backup.private_directory(root),backup.private_directory(live_root)
    require(root==root.resolve() and live_root==live_root.resolve(),'RECOVERY_CANONICAL_ROOT_REQUIRED')
    require(not root.is_relative_to(live_root) and not live_root.is_relative_to(root),'RECOVERY_LIVE_ROOT_OVERLAP')
    gate=private_json(root/GATE)
    require(isinstance(gate,dict) and gate.get('installationId')==manifest['installationId']
        and isinstance(gate.get('backupId'),str) and isinstance(gate.get('restoredAt'),str),'INVALID_RESTORE_GATE')
    policy=policy_digest(manifest,bindings)
    for rule in bindings['rules']:
        if rule['audience'] is not None:
            files.rdp.select_root(rule['sourceRoot'],manifest['sourceRoots'])
            check_scope(rule['audience'])
    operator=root/'operator'
    backup.private_directory(operator)
    fd=os.open(operator/'inventory.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    store=None
    try:
        backup.regular(operator/'inventory.lock')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        store=catalogue.Catalogue(operator,manifest['installationId'],'operator',manifest['maxFileBytes'])
        progress=private_json(root/PROGRESS) if (root/PROGRESS).exists() or (root/PROGRESS).is_symlink() else None
        if not progress or progress.get('policyFingerprint')!=policy or progress.get('backupId')!=gate['backupId']:
            # Commit invalidation before recording the new generation. A crash
            # between these writes repeats invalidation, never skips it.
            with store.write():
                store.db.execute("INSERT OR REPLACE INTO source_checks(document,checked_at,verified_at,outcome,sha256) SELECT id,'',NULL,'unavailable',NULL FROM documents WHERE state='indexed'")
            progress={'backupId':gate['backupId'],'policyFingerprint':policy,'beganAt':catalogue.now()}
            files.sync.atomic_json(root/PROGRESS,progress)
            backup.sync_directory(root)
        yield store,progress,policy
    finally:
        if store is not None:
            store.close()
        os.close(fd)


def pending(store,bindings,progress):
    rows=store.db.execute("SELECT d.*,c.verified_at FROM documents d LEFT JOIN source_checks c ON c.document=d.id WHERE d.state='indexed' ORDER BY coalesce(c.checked_at,''),d.id")
    return [dict(row) for row in rows if publication.resolve_audience(bindings,row['source']) is not None
        and (not row['verified_at'] or row['verified_at']<progress['beganAt'] or not store.source_current(row['source'],row['sha256']))]


def batch(root,live_root,manifest,bindings,check_scope,max_files=2,seconds=120,check=source.check,clock=time.monotonic):
    require(type(max_files) is int and 1<=max_files<=20 and type(seconds) is int and 1<=seconds<=480,'INVALID_RECOVERY_LIMIT')
    root=Path(root)
    with session(root,live_root,manifest,bindings,check_scope) as (store,progress,policy):
        started=clock()
        outcomes={}
        paused=None
        for document in pending(store,bindings,progress)[:max_files]:
            if clock()-started>=seconds:
                paused='BATCH_TIME_LIMIT'
                break
            # Verify the retained object before trusting its refreshed source.
            # A corrupt local restore is an integrity stop, not source absence.
            require(backup.digest(root/'operator'/'objects'/document['sha256']/'original')==document['sha256'],
                'RESTORE_ORIGINAL_HASH_MISMATCH')
            try:
                result=check(manifest,document['source'])
            except BlockingIOError:
                paused='SOURCE_BUSY'
                break
            except Exception as error:
                if isinstance(error,ValueError) and str(error)=='RDP_DRIVE_REDIRECTION_DISABLED':
                    raise
                result={'source':document['source'],'state':'unavailable'}
            outcome=store.record_source_check(document,result)
            outcomes[outcome]=outcomes.get(outcome,0)+1
        result={'checked':sum(outcomes.values()),'outcomes':outcomes,'pendingSourceChecks':len(pending(store,bindings,progress)),
            'employeeAccessEnabled':False}
        if paused:
            result['paused']=paused
        return result


def finalize(root,live_root,manifest,bindings,check_scope):
    root=Path(root)
    with session(root,live_root,manifest,bindings,check_scope) as (store,progress,policy):
        require(not pending(store,bindings,progress),'RECOVERY_SOURCE_CHECKS_PENDING')
        result=publication.publish(root,manifest['installationId'],bindings,check_scope,max_documents=1000)
        require(not result['bounded'],'RECOVERY_PUBLICATION_PENDING')
        # Recheck current external policy after the potentially long publication.
        require(policy_digest(manifest,bindings)==policy,'RECOVERY_POLICY_CHANGED')
        for rule in bindings['rules']:
            if rule['audience'] is not None:
                check_scope(rule['audience'])
        require(not pending(store,bindings,progress),'RECOVERY_SOURCE_CHECKS_PENDING')
        # New audience markers and partition database names must survive a
        # crash before the durable gate removal makes that partition readable.
        for directory in (root/'partitions').iterdir():
            backup.sync_directory(backup.private_directory(directory))
        backup.sync_directory(root/'partitions')
        receipt={'installationId':manifest['installationId'],'backupId':progress['backupId'],
            'policyFingerprint':policy,'beganAt':progress['beganAt'],'verifiedAt':catalogue.now(),
            'publication':result,'documentStates':dict(store.db.execute('SELECT state,count(*) FROM documents GROUP BY state')),
            'reconciliationVerified':True,'liveRootChanged':False}
        files.sync.atomic_json(root/'recovery-verified.json',receipt)
        backup.sync_directory(root)
        (root/GATE).unlink()
        backup.sync_directory(root)
        return {**receipt,'readerGateOpened':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['batch','finalize'])
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--bindings',required=True)
    parser.add_argument('--destination',required=True)
    parser.add_argument('--max-files',type=int,default=2)
    parser.add_argument('--seconds',type=int,default=120)
    args=parser.parse_args()
    require(os.geteuid()==0,'HOST_OPERATOR_REQUIRED')
    os.umask(0o077)
    manifest=files.sync.load_manifest(args.manifest)
    bindings_path=Path(args.bindings)
    bindings=json.loads(files.rdp.private_file(bindings_path).read_text())
    manifest['recoveryBindingsFile']=str(bindings_path)
    # This callback is read-only and checks current, separately provisioned scope
    # markers. Bindings copied inside the restored snapshot are never authority.
    def check_scope(audience):
        current=json.loads(files.rdp.private_file(bindings_path).read_text())
        require(current==bindings,'RECOVERY_POLICY_CHANGED')
        return files.sync.scope_directory(manifest,audience)
    arguments=(Path(args.destination),Path('/var/lib/aibrain/knowledge')/manifest['installationId'],manifest,bindings,check_scope)
    try:
        result=batch(*arguments,max_files=args.max_files,seconds=args.seconds) if args.operation=='batch' else finalize(*arguments)
    except BlockingIOError:
        result={'checked':0,'paused':'CATALOGUE_BUSY','employeeAccessEnabled':False}
    print(json.dumps(result))


if __name__=='__main__':
    main()
