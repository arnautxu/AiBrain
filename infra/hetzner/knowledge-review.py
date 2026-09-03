#!/usr/bin/env python3
"""Human review API on a separate app-server-only Unix socket.

The authenticated Next server resolves actor, current role, publication capability
and readable document scopes. Source write permission is never used or granted.
Workers/model tools have no review capability or socket. Peer UID is the
same trusted server boundary used for scoped document retrieval, not a user ID.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import socketserver
import stat
import threading
import uuid
import importlib.util

spec=importlib.util.spec_from_file_location('broker',Path(__file__).with_name('knowledge-broker.py'))
broker=importlib.util.module_from_spec(spec);spec.loader.exec_module(broker)
retrieval,publication,files=broker.retrieval,broker.publication,broker.files
require=broker.require


def valid(value,manifest):
    try:
        require(isinstance(value,dict) and set(value)=={'schemaVersion','installationId','connectionId','requestId','actorId','audience','operation','input'},'INVALID_REVIEW_REQUEST')
        require(value['schemaVersion']==1 and type(value['schemaVersion']) is int and value['installationId']==manifest['installationId']
                and value['connectionId']==manifest['connectionId'],'INVALID_REVIEW_BINDING')
        require(all(str(uuid.UUID(value[k]))==value[k] for k in ('requestId','actorId')),'INVALID_REVIEW_ID')
        publication.audience_key(value['audience'])
        args=value['input'];require(isinstance(args,dict),'INVALID_REVIEW_INPUT')
        if value['operation']=='list':
            require(set(args)=={'status','cursor'} and args['status'] in {'proposed','confirmed'} and type(args['cursor']) is int and 0<=args['cursor']<=2**53-1,'INVALID_REVIEW_PAGE')
        elif value['operation']=='correct':
            require(set(args)=={'recordId','revision','content','reason'} and str(uuid.UUID(args['recordId']))==args['recordId']
                and type(args['revision']) is int and 1<=args['revision']<=2**31-1
                and isinstance(args['content'],str) and 0<len(args['content'].strip())<=8000
                and isinstance(args['reason'],str) and 0<len(args['reason'].strip())<=1000,'INVALID_CORRECTION_COMMAND')
        else:
            require(value['operation']=='review' and set(args)=={'recordId','revision','decision'} and str(uuid.UUID(args['recordId']))==args['recordId']
                    and type(args['revision']) is int and 1<=args['revision']<=2**31-1 and args['decision'] in {'confirm','reject','delete'},'INVALID_REVIEW_COMMAND')
        return True
    except (ValueError,TypeError,KeyError,AttributeError):
        return False


def execute(value,manifest,bindings,root):
    require(valid(value,manifest),'INVALID_REVIEW_REQUEST')
    publication.validate_bindings(bindings,manifest['installationId'])
    audience=value['audience']
    require(any(r['audience']==audience for r in bindings['rules']),'SCOPE_UNAVAILABLE')
    files.sync.scope_directory(manifest,audience)
    reader=retrieval.Retrieval(root,manifest['installationId'],manifest['connectionId'],bindings,lambda a:a==audience)
    # Open through the same restoration/policy gate before any mutable access.
    checked=reader.open(audience);checked.close()
    store=retrieval.catalogue.Catalogue(root/'partitions'/publication.partition_id(audience),manifest['installationId'],publication.audience_key(audience),readonly=value['operation']=='list')
    memory=retrieval.derived.DerivedKnowledge(store)
    def permitted(record):
        return bool(record and record['citations'] and all(publication.resolve_audience(bindings,c['source'])==audience
            and reader.source_status(store,c['source'],c['sha256']) for c in record['citations']))
    def public(record):
        result={k:record[k] for k in ('id','kind','entity_type','entity_key','label','topic','content','status','revision','certainty','created','updated')}
        result['citations']=[{**c,'path':retrieval.reference(manifest['connectionId'],audience,c['source'],c['sha256'])} for c in record['citations']]
        result['conflicts']=[i for i in record['conflicts'][:100] if permitted(memory.get(i))]
        result['conflictsTruncated']=len(record['conflicts'])>100
        result['events']=[dict(r) for r in store.db.execute('SELECT revision,action,actor,recorded FROM knowledge_events WHERE record=? ORDER BY id DESC LIMIT 10',(record['id'],))]
        correction=store.db.execute('SELECT previous,previous_revision,reason FROM knowledge_corrections WHERE record=?',(record['id'],)).fetchone()
        if correction:
            previous=memory.get(correction['previous'],include_inactive=True)
            if permitted(previous):
                result['correction']={'previousRecordId':previous['id'],'previousRevision':correction['previous_revision'],
                    'previousContent':previous['content'],'reason':correction['reason']}
        return result
    try:
        args=value['input']
        if value['operation'] in {'review','correct'}:
            current=memory.get(args['recordId'])
            require(permitted(current),'RECORD_SOURCE_UNAVAILABLE')
            if value['operation']=='correct':
                result=memory.correct(args['recordId'],args['revision'],args['content'],args['reason'],value['actorId'],lambda actor:actor==value['actorId'])
            else:
                require(args['decision']=='delete' or current['status']=='proposed','RECORD_NOT_REVIEWABLE')
                result=memory.review(args['recordId'],args['revision'],args['decision'],value['actorId'],lambda actor:actor==value['actorId'])
            return {'available':True,'record':public(result),'checkedAt':retrieval.catalogue.now()}
        rows=store.db.execute('SELECT rowid,id FROM knowledge_records WHERE status=? AND rowid>? ORDER BY rowid LIMIT 100',(args['status'],args['cursor'])).fetchall()
        result,size,cursor=[],0,args['cursor']
        for row in rows:
            record=memory.get(row['id'])
            if not permitted(record):
                cursor=row['rowid'];continue
            item=public(record);item_size=len(json.dumps(item,ensure_ascii=False).encode())
            if size+item_size>220000 or len(result)>=20:
                break
            result.append(item);size+=item_size;cursor=row['rowid']
        more=store.db.execute('SELECT 1 FROM knowledge_records WHERE status=? AND rowid>? LIMIT 1',(args['status'],cursor)).fetchone()
        return {'available':True,'records':result,'nextCursor':cursor if more else None,'checkedAt':retrieval.catalogue.now()}
    finally:
        store.close()


class Server(broker.Server):
    def __init__(self,address,manifest,bindings_path,root):
        self.manifest,self.bindings_path,self.root=manifest,bindings_path,root
        self.slots=threading.BoundedSemaphore(2)
        socketserver.UnixStreamServer.__init__(self,str(address),Handler)


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        acquired=False
        try:
            self.connection.settimeout(10)
            raw=self.rfile.readline(65537)
            if len(raw)>65536 or not raw.endswith(b'\n'):return
            value=json.loads(raw)
            if not valid(value,self.server.manifest):return
            acquired=self.server.slots.acquire(blocking=False)
            if not acquired:
                result={'available':False,'error':'KNOWLEDGE_BUSY'}
            else:
                try:
                    bindings=json.loads(files.rdp.private_file(self.server.bindings_path).read_text())
                    result=execute(value,self.server.manifest,bindings,self.server.root)
                except (ValueError,OSError,broker.sqlite3.DatabaseError) as error:
                    code=str(error) if isinstance(error,ValueError) else 'KNOWLEDGE_UNAVAILABLE'
                    result={'available':False,'error':code if code in {'REVISION_CONFLICT','CORRECTION_UNCHANGED','INVALID_KNOWLEDGE_TEXT','RECORD_NOT_REVIEWABLE','RECORD_SOURCE_UNAVAILABLE','SCOPE_UNAVAILABLE','RESTORE_RECONCILIATION_REQUIRED'} else 'KNOWLEDGE_UNAVAILABLE'}
            result.update(requestId=value['requestId'],installationId=value['installationId'],connectionId=value['connectionId'],audience=value['audience'])
            encoded=json.dumps(result,ensure_ascii=False).encode()+b'\n'
            if len(encoded)<=256*1024:self.wfile.write(encoded)
        except (ValueError,OSError):pass
        finally:
            if acquired:self.server.slots.release()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',required=True);parser.add_argument('--bindings',required=True)
    args=parser.parse_args();require(os.geteuid()==0,'HOST_OPERATOR_REQUIRED');os.umask(0o077)
    manifest=files.sync.load_manifest(args.manifest)
    bindings=publication.validate_bindings(json.loads(files.rdp.private_file(args.bindings).read_text()),manifest['installationId'])
    directory=Path(manifest['dataRootHost'])/'locks'/'knowledge-review'
    broker.prepare_socket_directory(directory,manifest['appGid'])
    descriptor=directory/(manifest['connectionId']+'.json')
    audiences={publication.partition_id(r['audience']):r['audience'] for r in bindings['rules'] if r['audience'] is not None}
    files.sync.atomic_json(descriptor,{'schemaVersion':1,'installationId':manifest['installationId'],'connectionId':manifest['connectionId'],'mode':'human-review','publications':list(audiences.values())})
    os.chown(descriptor,0,manifest['appGid']);os.chmod(descriptor,0o440)
    address=directory/(manifest['connectionId']+'.sock')
    if address.exists() or address.is_symlink():
        info=address.lstat();require(stat.S_ISSOCK(info.st_mode) and info.st_uid==0,'UNSAFE_SOCKET')
        with socket.socket(socket.AF_UNIX) as probe:
            try:probe.connect(str(address))
            except ConnectionRefusedError:address.unlink()
            else:raise ValueError('BROKER_ALREADY_RUNNING')
    with Server(address,manifest,args.bindings,Path('/var/lib/aibrain/knowledge')/manifest['installationId']) as server:
        os.chown(address,0,manifest['appGid']);os.chmod(address,0o660)
        server.serve_forever(poll_interval=0.5)


if __name__=='__main__':main()
