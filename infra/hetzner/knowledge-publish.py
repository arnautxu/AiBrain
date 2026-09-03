#!/usr/bin/env python3
"""Explicit source-to-audience publication into isolated knowledge partitions."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import uuid

spec = importlib.util.spec_from_file_location("knowledge_ingest",Path(__file__).with_name("knowledge-ingest.py"))
ingest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)
catalogue, files = ingest.catalogue, ingest.files
require = catalogue.require


def audience_key(audience):
    require(isinstance(audience,dict) and set(audience)=={"scope","scopeId"},"INVALID_AUDIENCE")
    scope,identifier = audience["scope"],audience["scopeId"]
    require(scope in {"company","department","project","private"},"INVALID_SCOPE")
    if scope=="company":
        require(identifier is None,"INVALID_SCOPE_ID")
        return "company"
    require(isinstance(identifier,str) and files.sync.UUID.fullmatch(identifier) and str(uuid.UUID(identifier))==identifier,"INVALID_SCOPE_ID")
    return scope+":"+identifier


def partition_id(audience):
    return hashlib.sha256(audience_key(audience).encode()).hexdigest()[:32]


def validate_bindings(value,installation):
    require(isinstance(value,dict) and set(value)=={"schemaVersion","installationId","rules"} and
            type(value["schemaVersion"]) is int and value["schemaVersion"]==1 and value["installationId"]==installation,
            "INVALID_PUBLICATION_BINDINGS")
    require(isinstance(value["rules"],list) and len(value["rules"])<=256,"INVALID_PUBLICATION_RULES")
    seen = set()
    for rule in value["rules"]:
        require(isinstance(rule,dict) and set(rule)=={"sourceRoot","audience"},"INVALID_PUBLICATION_RULE")
        source = catalogue.source_key(files.rdp.windows_path(rule["sourceRoot"]))
        require(source not in seen,"DUPLICATE_SOURCE_BINDING")
        seen.add(source)
        # null is an explicit exclusion nested below a broader publication.
        if rule["audience"] is not None:
            audience_key(rule["audience"])
    return value


def resolve_audience(bindings,source):
    key = catalogue.source_key(source)
    candidates = [rule for rule in bindings["rules"] if key==catalogue.source_key(rule["sourceRoot"]) or
                  key.startswith(catalogue.source_key(rule["sourceRoot"]).rstrip("\\")+"\\")]
    if not candidates:
        return None
    return max(candidates,key=lambda rule:len(rule["sourceRoot"]))["audience"]


def sync_source_check(operator,target,document):
    row=target.document(document['source'])
    check=operator.db.execute('SELECT checked_at,verified_at,outcome,sha256 FROM source_checks WHERE document=?',(document['id'],)).fetchone()
    values=(row['id'],)+ (tuple(check) if check else (document['indexed_at'],document['indexed_at'],'present',document['sha256']))
    existing=target.db.execute('SELECT * FROM source_checks WHERE document=?',(row['id'],)).fetchone()
    if existing is None or tuple(existing)!=values:
        with target.write():
            target.db.execute('INSERT OR REPLACE INTO source_checks VALUES(?,?,?,?,?)',values)


def publish(root,installation,bindings,check_scope,max_documents=100):
    validate_bindings(bindings,installation)
    require(type(max_documents) is int and 1<=max_documents<=1000,"INVALID_PUBLICATION_LIMIT")
    operator = catalogue.Catalogue(root/"operator",installation,"operator",readonly=True)
    operator.db.execute("BEGIN")
    partitions = root/"partitions"
    partitions.mkdir(mode=0o700,exist_ok=True)
    files.sync.secure_dir(partitions,owner=os.geteuid())
    audiences = {partition_id(rule["audience"]):rule["audience"] for rule in bindings["rules"] if rule["audience"] is not None}
    revoked, published = 0,0
    try:
        # Existing partitions whose binding vanished are withdrawn as well. No
        # source absence is inferred here: this is explicit policy reconciliation.
        for directory in partitions.iterdir():
            require(re.fullmatch(r"[a-f0-9]{32}",directory.name) and directory.is_dir() and not directory.is_symlink(),"UNSAFE_PARTITION")
            marker = directory/"audience.json"
            ingest.regular(marker)
            audience = json.loads(marker.read_text())
            require(partition_id(audience)==directory.name,"PARTITION_BINDING_MISMATCH")
            target = catalogue.Catalogue(directory,installation,audience_key(audience))
            try:
                for row in target.db.execute("SELECT source,state,sha256,fingerprint FROM documents WHERE state<>'withdrawn'").fetchall():
                    original = operator.document(row["source"])
                    if directory.name not in audiences or resolve_audience(bindings,row["source"])!=audience or not original or original["state"]!="indexed" or original["sha256"]!=row["sha256"] or original["fingerprint"]!=row["fingerprint"]:
                        target.withdraw(row["source"],"SCOPE_CHANGED")
                        revoked+=1
            finally:
                target.close()
        # Bounded batches skip already current versions, so successive runs
        # progress without repeatedly copying/indexing the first documents.
        for row in operator.db.execute("SELECT * FROM documents WHERE state='indexed' ORDER BY id"):
            document = dict(row)
            audience = resolve_audience(bindings,document["source"])
            if audience is None or not operator.source_current(document['source'],document['sha256']):
                continue
            check_scope(audience)
            directory = partitions/partition_id(audience)
            directory.mkdir(mode=0o700,exist_ok=True)
            files.sync.secure_dir(directory,owner=os.geteuid())
            marker = directory/"audience.json"
            if marker.exists() or marker.is_symlink():
                ingest.regular(marker)
                require(json.loads(marker.read_text())==audience,"PARTITION_BINDING_MISMATCH")
            else:
                files.sync.atomic_json(marker,audience)
            target = catalogue.Catalogue(directory,installation,audience_key(audience))
            try:
                previous = target.document(document["source"])
                source_payload=operator.db.execute("SELECT payload_hash FROM document_payloads WHERE document=?",(document["id"],)).fetchone()
                target_payload=target.db.execute("SELECT payload_hash FROM document_payloads WHERE document=?",(previous["id"],)).fetchone() if previous else None
                if previous and previous["state"]=="indexed" and previous["sha256"]==document["sha256"] and previous["fingerprint"]==document["fingerprint"] and (source_payload[0] if source_payload else None)==(target_payload[0] if target_payload else None):
                    sync_source_check(operator,target,document)
                    if previous["last_seen"]!=document["last_seen"] or previous["seen_scan"]!=document["seen_scan"]:
                        with target.write():
                            target.db.execute("UPDATE documents SET last_seen=?,seen_scan=? WHERE id=?",(document["last_seen"],document["seen_scan"],previous["id"]))
                    continue
                # Publication is an explicit authorization after a scope change;
                # it is the only path that reactivates a withdrawn partition row.
                with target.write():
                    target.db.execute("""INSERT INTO documents(source_key,source,name,suffix,bytes,modified,fingerprint,seen_scan,last_seen,state)
                        VALUES(?,?,?,?,?,?,?,?,?,'pending') ON CONFLICT(source_key) DO UPDATE SET bytes=excluded.bytes,modified=excluded.modified,
                        fingerprint=excluded.fingerprint,seen_scan=excluded.seen_scan,last_seen=excluded.last_seen,state='pending',reason=NULL""",
                        tuple(document[k] for k in ("source_key","source","name","suffix","bytes","modified","fingerprint","seen_scan","last_seen")))
                content = [dict(chunk) for chunk in operator.db.execute("SELECT locator,content FROM chunks WHERE document=? ORDER BY ordinal",(document["id"],))]
                structured=operator.structured_document(document["source"],document["sha256"]) if source_payload else None
                target.index_document(document["source"],document["fingerprint"],document["sha256"],content,structured=structured)
                sync_source_check(operator,target,document)
                published+=1
            finally:
                target.close()
            if published>=max_documents:
                break
        return {"published":published,"withdrawn":revoked,"partitions":len(audiences),"bounded":published>=max_documents}
    finally:
        operator.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest",required=True)
    parser.add_argument("--bindings",required=True)
    args = parser.parse_args()
    require(os.geteuid()==0,"HOST_OPERATOR_REQUIRED")
    os.umask(0o077)
    manifest = files.sync.load_manifest(args.manifest)
    bindings = json.loads(files.rdp.private_file(args.bindings).read_text())
    root = Path("/var/lib/aibrain/knowledge")/manifest["installationId"]
    print(json.dumps(publish(root,manifest["installationId"],bindings,lambda audience:files.sync.scope_directory(manifest,audience))))


if __name__ == "__main__":
    main()
