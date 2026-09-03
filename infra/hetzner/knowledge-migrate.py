#!/usr/bin/env python3
"""Add review/summary tables to quiesced, backed-up catalogue partitions.

The operator must stop scheduled writers and verify a backup before calling this
module. Existing rows/schema are checked before and after each additive upgrade;
an interrupted multi-partition upgrade can be resumed without deleting data.
"""
import importlib.util
from pathlib import Path
import tempfile

spec=importlib.util.spec_from_file_location('catalogue',Path(__file__).with_name('knowledge-catalogue.py'))
catalogue=importlib.util.module_from_spec(spec);spec.loader.exec_module(catalogue)
require=catalogue.require
ADDITIONS={'summary_jobs','summary_execution','knowledge_corrections'}


def schema(db):
    return {(r[0],r[1]):r[2] for r in db.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")}


def counts(db,definitions):
    # Names come only from SQLite schema, but still quote them as identifiers.
    return {name:db.execute('SELECT count(*) FROM "'+name.replace('"','""')+'"').fetchone()[0]
            for kind,name in definitions if kind=='table'}


def migrate_partition(directory,installation,audience):
    # Open read-only first: wrong identity/path or unexpected preexisting tables
    # must fail before Catalogue's additive initialization can touch the store.
    before=catalogue.Catalogue(directory,installation,audience,readonly=True)
    try:
        definitions=schema(before.db);rows=counts(before.db,definitions)
    finally:before.close()
    with tempfile.TemporaryDirectory(prefix='knowledge-schema-') as temporary:
        reference=catalogue.Catalogue(Path(temporary).resolve()/'reference',installation,audience)
        try:expected=schema(reference.db)
        finally:reference.close()
    for name in ADDITIONS:
        key=('table',name)
        require(key not in definitions or definitions[key]==expected[key],'UNEXPECTED_MIGRATION_SCHEMA')
    target=catalogue.Catalogue(directory,installation,audience)
    try:
        after=schema(target.db)
        require(all(after.get(key)==value for key,value in definitions.items()),'MIGRATION_CHANGED_EXISTING_SCHEMA')
        require(set(after)-set(definitions)<= {('table',name) for name in ADDITIONS},'UNEXPECTED_MIGRATION_ADDITION')
        require(counts(target.db,definitions)==rows,'MIGRATION_CHANGED_EXISTING_ROWS')
        require(target.db.execute('PRAGMA quick_check').fetchall()[0][0]=='ok','MIGRATION_INTEGRITY_FAILED')
        require(not target.db.execute('PRAGMA foreign_key_check').fetchall(),'MIGRATION_FOREIGN_KEY_FAILED')
        return {'addedTables':sorted(name for name in ADDITIONS if ('table',name) not in definitions),
                'existingTablesVerified':len(rows),'existingRowsPreserved':True}
    finally:target.close()
