#!/usr/bin/env python3
"""Verify one real approved source and one nonexistent path without Windows writes."""
import argparse
import fcntl
import importlib.util
import json
import ntpath
import os
from pathlib import Path
import uuid

spec=importlib.util.spec_from_file_location('reconcile',Path(__file__).with_name('knowledge-reconcile.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--bindings',required=True)
    args=parser.parse_args()
    r.require(os.geteuid()==0,'HOST_OPERATOR_REQUIRED')
    os.umask(0o077)
    m=r.publication.files.sync.load_manifest(args.manifest)
    bindings=r.publication.validate_bindings(json.loads(r.publication.files.rdp.private_file(args.bindings).read_text()),m['installationId'])
    root=Path('/var/lib/aibrain/knowledge')/m['installationId']/'operator'
    store=r.catalogue.Catalogue(root,m['installationId'],'operator',m['maxFileBytes'])
    fd=os.open(root/'inventory.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        r.publication.ingest.regular(root/'inventory.lock')
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'state':'waiting','reason':'CATALOGUE_BUSY'}));return
        document=next((dict(row) for row in store.db.execute("SELECT * FROM documents WHERE state='indexed' ORDER BY bytes")
                       if r.publication.resolve_audience(bindings,row['source']) is not None),None)
        r.require(document is not None,'NO_APPROVED_INDEXED_DOCUMENT')
        try:
            result=r.source.check(m,document['source'])
            r.require(result['state']=='present' and result['sha256']==document['sha256'] and result['bytes']==document['bytes'],'REAL_SOURCE_NOT_MATCHING')
            store.record_source_check(document,result)
            missing=ntpath.join(ntpath.dirname(document['source']),'AIBRAIN_ABSENCE_CHECK_'+str(uuid.uuid4())+'.txt')
            absent=r.source.check(m,missing)
            r.require(absent['state']=='missing','MISSING_SOURCE_NOT_CONFIRMED')
        except BlockingIOError:
            print(json.dumps({'state':'waiting','reason':'SOURCE_BUSY'}));return
        print(json.dumps({'state':'passed','realSourceSha256':result['sha256'],'bytes':result['bytes'],
                          'missingSourceConfirmed':True,'windowsWrites':False,'recordedAt':result['recordedAt']}))
    finally:
        os.close(fd);store.close()


if __name__=='__main__': main()
