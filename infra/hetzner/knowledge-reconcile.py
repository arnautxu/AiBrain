#!/usr/bin/env python3
"""Bounded source hash/permission checks; outage is not deletion."""
import argparse
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path


def module(name,filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


publication=module('publication','knowledge-publish.py')
source=module('source','knowledge-source-check.py')
catalogue,require=publication.catalogue,publication.require


def batch(store,manifest,bindings,max_files=2,interval_seconds=3600,check=source.check):
    require(type(max_files) is int and 1<=max_files<=20 and type(interval_seconds) is int and 300<=interval_seconds<=86400,'INVALID_CHECK_LIMIT')
    publication.validate_bindings(bindings,manifest['installationId'])
    cutoff=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=interval_seconds)).isoformat()
    # Recheck explicit permission denials as well as indexed files. Mere tree
    # discovery cannot reactivate a denial; a successful real read can.
    priorities=[catalogue.source_key(rule['sourceRoot']).rstrip('\\') for rule in bindings['rules'] if rule['audience'] is not None]
    clauses=["(d.source_key=? OR instr(d.source_key,?||'\\')=1)" for _ in priorities]
    order='CASE WHEN '+ ' OR '.join(clauses)+' THEN 0 ELSE 1 END,' if clauses else ''
    values=[cutoff]+[p for priority in priorities for p in [priority]*2]
    rows=[dict(r) for r in store.db.execute("SELECT d.* FROM documents d LEFT JOIN source_checks c ON c.document=d.id WHERE (d.state='indexed' OR (d.state='withdrawn' AND d.reason IN ('ACCESS_REVOKED','SOURCE_DELETED'))) AND coalesce(c.checked_at,d.indexed_at,'')<? ORDER BY "+order+"coalesce(c.checked_at,d.indexed_at,''),d.id LIMIT 1000",values)]
    rows.sort(key=lambda r:publication.resolve_audience(bindings,r['source']) is None)
    outcomes={}
    for document in rows[:max_files]:
        try:
            result=check(manifest,document['source'])
        except BlockingIOError:
            return {'checked':sum(outcomes.values()),'outcomes':outcomes,'paused':'SOURCE_BUSY'}
        except Exception as error:
            if isinstance(error,ValueError) and str(error)=='RDP_DRIVE_REDIRECTION_DISABLED':
                raise
            result={'source':document['source'],'state':'unavailable'}
        outcome=store.record_source_check(document,result)
        outcomes[outcome]=outcomes.get(outcome,0)+1
    return {'checked':sum(outcomes.values()),'outcomes':outcomes,'bounded':len(rows)>max_files}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--bindings',required=True)
    parser.add_argument('--max-files',type=int,default=2)
    parser.add_argument('--interval-seconds',type=int,default=3600)
    args=parser.parse_args()
    require(os.geteuid()==0,'HOST_OPERATOR_REQUIRED')
    os.umask(0o077)
    manifest=publication.files.sync.load_manifest(args.manifest)
    bindings=json.loads(publication.files.rdp.private_file(args.bindings).read_text())
    root=Path('/var/lib/aibrain/knowledge')/manifest['installationId']
    store=catalogue.Catalogue(root/'operator',manifest['installationId'],'operator',manifest['maxFileBytes'])
    fd=os.open(root/'operator'/'inventory.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        publication.ingest.regular(root/'operator'/'inventory.lock')
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'checked':0,'paused':'CATALOGUE_BUSY'}))
            return
        result=batch(store,manifest,bindings,args.max_files,args.interval_seconds)
        result['publication']=publication.publish(root,manifest['installationId'],bindings,lambda a:publication.files.sync.scope_directory(manifest,a))
        print(json.dumps(result))
    finally:
        os.close(fd)
        store.close()


if __name__=='__main__':
    main()
