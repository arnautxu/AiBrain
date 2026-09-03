#!/usr/bin/env python3
"""Fresh host authorization for explicitly approved semantic jobs.

Publication permits reading; it does not by itself authorize model dispatch.
This adapter never creates grants, prepares documents or configures a provider.
"""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re

def load_module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

retrieval=load_module('generation_retrieval','knowledge-retrieval.py')
worker=load_module('generation_worker','knowledge-summary-worker.py')
publication,catalogue,files=retrieval.publication,retrieval.catalogue,retrieval.files
require=catalogue.require
SHA=re.compile(r'[a-f0-9]{64}')


def private_json(path):
    path=files.rdp.private_file(path)
    with path.open('rb') as source:
        raw=source.read(1024*1024+1)
    require(len(raw)<=1024*1024,'GENERATION_CONFIG_TOO_LARGE')
    return json.loads(raw)


def validate(value,manifest):
    require(isinstance(value,dict) and set(value)=={'schemaVersion','installationId','connectionId','enabled','modelKey','expiresAt','grants'},'INVALID_GENERATION_POLICY')
    require(type(value['schemaVersion']) is int and value['schemaVersion']==1
        and value['installationId']==manifest['installationId'] and value['connectionId']==manifest['connectionId'],'GENERATION_BINDING_MISMATCH')
    require(type(value['enabled']) is bool and isinstance(value['modelKey'],str)
        and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}',value['modelKey']),'INVALID_GENERATION_MODEL')
    try:
        expiry=dt.datetime.fromisoformat(value['expiresAt'].replace('Z','+00:00'))
        require(expiry.tzinfo is not None,'INVALID_GENERATION_EXPIRY')
    except (ValueError,TypeError,AttributeError):raise ValueError('INVALID_GENERATION_EXPIRY') from None
    require(isinstance(value['grants'],list) and len(value['grants'])<=256,'INVALID_GENERATION_GRANTS')
    seen=set()
    for grant in value['grants']:
        require(isinstance(grant,dict) and set(grant)=={'jobId','source','sha256','audience'},'INVALID_GENERATION_GRANT')
        require(all(isinstance(grant[k],str) and SHA.fullmatch(grant[k]) for k in ('jobId','sha256')),'INVALID_GENERATION_VERSION')
        catalogue.source_key(grant['source']);publication.audience_key(grant['audience'])
        require(grant['jobId'] not in seen,'DUPLICATE_GENERATION_JOB');seen.add(grant['jobId'])
    return value,expiry


class GenerationPolicy:
    def __init__(self,root,manifest,bindings_path,policy_path,clock=None):
        self.root=Path(root)
        require(self.root.is_absolute() and self.root==self.root.resolve(),'CANONICAL_GENERATION_ROOT_REQUIRED')
        require(all(isinstance(manifest.get(k),str) and catalogue.ID.fullmatch(manifest[k]) for k in ('installationId','connectionId')),'INVALID_GENERATION_INSTALLATION')
        self.manifest,self.bindings_path,self.policy_path=manifest,bindings_path,policy_path
        self.clock=clock or (lambda:dt.datetime.now(dt.timezone.utc))

    def permission(self,job,expected=None):
        require(isinstance(job,str) and SHA.fullmatch(job),'INVALID_GENERATION_JOB')
        policy,expiry=validate(private_json(self.policy_path),self.manifest)
        require(policy['enabled'] and self.clock()<expiry,'GENERATION_DISABLED_OR_EXPIRED')
        grant=next((g for g in policy['grants'] if g['jobId']==job),None)
        require(grant is not None,'GENERATION_JOB_NOT_GRANTED')
        binding={'grant':grant,'modelKey':policy['modelKey']}
        require(expected is None or binding==expected,'GENERATION_GRANT_CHANGED')
        bindings=publication.validate_bindings(private_json(self.bindings_path),self.manifest['installationId'])
        require(publication.resolve_audience(bindings,grant['source'])==grant['audience'],'GENERATION_SOURCE_NOT_PUBLISHED')
        files.sync.scope_directory(self.manifest,grant['audience'])
        reader=retrieval.Retrieval(self.root,self.manifest['installationId'],self.manifest['connectionId'],bindings,lambda a:a==grant['audience'])
        store=reader.open(grant['audience'])
        try:
            require(reader.source_status(store,grant['source'],grant['sha256']),'GENERATION_SOURCE_UNAVAILABLE')
            row=store.db.execute('SELECT s.sha256,d.source FROM summary_jobs s JOIN documents d ON d.id=s.document WHERE s.id=?',(job,)).fetchone()
            require(row and row['sha256']==grant['sha256'] and catalogue.source_key(row['source'])==catalogue.source_key(grant['source']),'GENERATION_JOB_VERSION_MISMATCH')
            return binding
        finally:store.close()

    def run_step(self,job,adapter):
        binding=self.permission(job)
        require(getattr(adapter,'model_key',None)==binding['modelKey'],'GENERATION_ADAPTER_MISMATCH')
        audience=binding['grant']['audience']
        store=catalogue.Catalogue(self.root/'partitions'/publication.partition_id(audience),self.manifest['installationId'],publication.audience_key(audience))
        def authorized(identifier):
            require(identifier==job,'GENERATION_JOB_MISMATCH')
            self.permission(identifier,binding)
            return True
        try:
            executor=worker.Worker(store,binding['modelKey'],authorized)
            executor.enqueue(job)
            return executor.step(job,adapter)
        finally:store.close()
