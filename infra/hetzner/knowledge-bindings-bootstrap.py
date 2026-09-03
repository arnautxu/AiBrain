#!/usr/bin/env python3
"""Seed index publication from the existing, explicitly approved small mirror."""
import argparse
import importlib.util
import json
import os
from pathlib import Path

spec=importlib.util.spec_from_file_location("publish",Path(__file__).with_name("knowledge-publish.py"))
publish=importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approved-mirror",required=True)
    parser.add_argument("--bindings",required=True)
    args=parser.parse_args()
    publish.require(os.geteuid()==0,"HOST_OPERATOR_REQUIRED")
    os.umask(0o077)
    manifest=publish.files.sync.load_manifest(args.approved_mirror)
    publish.require(manifest["publications"]==[{"scope":"company","scopeId":None}],"EXISTING_COMPANY_PUBLICATION_REQUIRED")
    publish.files.sync.scope_directory(manifest,manifest["publications"][0])
    value={"schemaVersion":1,"installationId":manifest["installationId"],
           "rules":[{"sourceRoot":root,"audience":manifest["publications"][0]} for root in manifest["sourceRoots"]]}
    publish.validate_bindings(value,manifest["installationId"])
    target=Path(args.bindings)
    publish.files.sync.secure_dir(target.parent)
    if target.exists() or target.is_symlink():
        existing=json.loads(publish.files.rdp.private_file(target).read_text())
        publish.require(existing==value,"EXISTING_BINDINGS_PRESERVED")
    else:
        publish.files.sync.atomic_json(target,value)
    directory=Path(manifest["dataRootHost"])/"locks"/"knowledge"
    directory.mkdir(mode=0o750,exist_ok=True)
    publish.files.sync.secure_dir(directory)
    os.chown(directory,0,manifest["appGid"])
    os.chmod(directory,0o750)
    print(json.dumps({"sourceRules":len(value["rules"]),"audience":"existing-company-readers","allOtherSources":"operator-only"}))


if __name__=="__main__":
    main()
