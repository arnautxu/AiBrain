#!/usr/bin/env python3
"""Extract proposed entity facts from explicitly mapped source columns.

Column meaning and identity namespaces are operator configuration. No employee
role, identifier, permission or organization relation is guessed from prose.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re


def module(name,filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


derived=module("derived","knowledge-derived.py")
publication=module("publication","knowledge-publish.py")
require=derived.require


def validate_mapping(mapping):
    require(isinstance(mapping,dict) and set(mapping)=={"entityType","entityNamespace","headerRow","identityColumn","labelColumn","fields"},"INVALID_ENTITY_MAPPING")
    require(mapping["entityType"] in derived.ENTITY_TYPES and type(mapping["headerRow"]) is int and 1<=mapping["headerRow"]<=100,"INVALID_ENTITY_MAPPING")
    derived.text(mapping["entityNamespace"],100)
    require(isinstance(mapping["fields"],list) and 1<=len(mapping["fields"])<=10,"INVALID_FIELD_MAPPING")
    for field in mapping["fields"]:
        require(isinstance(field,dict) and set(field)=={"column","topic"},"INVALID_FIELD_MAPPING")
        derived.text(field["topic"],120)
    columns=[mapping["identityColumn"],mapping["labelColumn"]]+[f["column"] for f in mapping["fields"]]
    require(all((type(c) is int and 1<=c<=10000) or (isinstance(c,str) and re.fullmatch(r"[A-Z]{1,3}",c)) for c in columns),"INVALID_COLUMN")
    require(len({f["topic"] for f in mapping["fields"]})==len(mapping["fields"]),"DUPLICATE_TOPIC")


def derive_table(store,source,sha256,table_index,mapping,offset=0,limit=100):
    validate_mapping(mapping)
    require(type(offset) is int and offset>=0 and type(limit) is int and 1<=limit<=500,"INVALID_DERIVATION_PAGE")
    payload=store.structured_document(source,sha256)
    require(type(table_index) is int and 0<=table_index<len(payload["tables"]),"TABLE_UNAVAILABLE")
    table=payload["tables"][table_index]
    excel="cells" in table
    columns=[mapping["identityColumn"],mapping["labelColumn"]]+[f["column"] for f in mapping["fields"]]
    require(all(isinstance(c,str) if excel else type(c) is int for c in columns),"COLUMN_KIND_MISMATCH")
    header=mapping["headerRow"]
    if excel:
        cells={cell["cell"]:cell["value"] for cell in table["cells"]}
        rows=sorted({int(re.search(r"[0-9]+$",address)[0]) for address in cells if int(re.search(r"[0-9]+$",address)[0])>header})
        def value(row,column):
            return cells.get(column+str(row),"").strip(),table["locator"]+"!"+column+str(row)
    else:
        rows=list(range(header+1,len(table["rows"])+1))
        def value(row,column):
            cells=table["rows"][row-1] if row<=len(table["rows"]) else []
            return (cells[column-1].strip() if column<=len(cells) else ""),f"{table['locator']}:row:{row}:column:{column}"
    require(all(value(header,column)[0] for column in columns),"MAPPED_HEADER_MISSING")
    # Duplicate explicit identifiers may represent repeated transactions, not
    # distinct employees. Do not silently choose the first or merge their roles.
    identities={}
    for row in rows:
        identity=value(row,mapping["identityColumn"])[0].casefold()
        if identity:
            identities[identity]=identities.get(identity,0)+1
    memory=derived.DerivedKnowledge(store)
    counts={"proposed":0,"skippedRows":0,"rejectedFields":0}
    for row in rows[offset:offset+limit]:
        identity,identity_locator=value(row,mapping["identityColumn"])
        label,label_locator=value(row,mapping["labelColumn"])
        if not identity or not label or identities[identity.casefold()]!=1:
            counts["skippedRows"]+=1
            continue
        entity={"type":mapping["entityType"],"key":hashlib.sha256(json.dumps([mapping["entityNamespace"],identity.casefold()]).encode()).hexdigest(),"label":label}
        for field in mapping["fields"]:
            fact,locator=value(row,field["column"])
            if not fact:
                continue
            header_value,header_locator=value(header,field["column"])
            evidence={identity_locator:identity,label_locator:label,header_locator:header_value,locator:fact}
            citations=[{"source":source,"sha256":sha256,"locator":location,"quote":quote} for location,quote in evidence.items()]
            key=hashlib.sha256(json.dumps([source,sha256,table_index,row,mapping,field],sort_keys=True).encode()).hexdigest()
            try:
                record=memory.propose("fact",entity,field["topic"],fact,citations,"mapped:"+key)
                if record and record["status"] in {"proposed","confirmed"}:
                    counts["proposed"]+=1
            except ValueError:
                counts["rejectedFields"]+=1
    return {**counts,"processedRows":len(rows[offset:offset+limit]),"totalRows":len(rows),
            "nextOffset":offset+limit if offset+limit<len(rows) else None}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest",required=True)
    parser.add_argument("--bindings",required=True)
    parser.add_argument("--rule",required=True,help="Private JSON: exact source, tableIndex and explicit mapping")
    parser.add_argument("--offset",type=int,default=0)
    args=parser.parse_args()
    require(os.geteuid()==0,"HOST_OPERATOR_REQUIRED")
    os.umask(0o077)
    files=publication.files
    manifest=files.sync.load_manifest(args.manifest)
    bindings=publication.validate_bindings(json.loads(files.rdp.private_file(args.bindings).read_text()),manifest["installationId"])
    rule=json.loads(files.rdp.private_file(args.rule).read_text())
    require(isinstance(rule,dict) and set(rule)=={"source","tableIndex","mapping"},"INVALID_DERIVATION_RULE")
    audience=publication.resolve_audience(bindings,rule["source"])
    require(audience is not None,"SOURCE_NOT_PUBLISHED")
    files.sync.scope_directory(manifest,audience)
    root=Path("/var/lib/aibrain/knowledge")/manifest["installationId"]/"partitions"/publication.partition_id(audience)
    require((root/"catalogue.sqlite3").is_file(),"PARTITION_NOT_PUBLISHED")
    store=publication.catalogue.Catalogue(root,manifest["installationId"],publication.audience_key(audience))
    try:
        document=store.document(rule["source"])
        require(document and document["state"]=='indexed',"DOCUMENT_NOT_INDEXED")
        print(json.dumps(derive_table(store,rule["source"],document["sha256"],rule["tableIndex"],rule["mapping"],args.offset)))
    finally:
        store.close()


if __name__=='__main__':
    main()
