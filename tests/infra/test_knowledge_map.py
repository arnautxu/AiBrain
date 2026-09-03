import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

INFRA = Path(__file__).resolve().parents[2] / 'infra/hetzner'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, INFRA / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


mapping = load('mapping', 'knowledge-map.py')
catalogue = load('map_catalogue', 'knowledge-catalogue.py')
files = load('map_files_test', 'rdp-server-files.py')


class MapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.store = catalogue.Catalogue(self.root / 'operator', 'test', 'operator')
        self.addCleanup(self.store.close)
        self.manifest = {'installationId': 'test', 'connectionId': 'fictional', 'sourceRoots': ['Y:\\'],
                         'connectionConfig': 'fixture', 'accessManifest': 'fixture', 'publications': [{'scope': 'company', 'scopeId': None}]}
        self.access = {'readRoots': ['Y:\\']}
        config = patch.object(files.rdp, 'load_config', lambda *_: ({}, {}, self.access, self.root))
        config.start(); self.addCleanup(config.stop)
        self.scan = self.store.start_scan(['Y:\\'])
        self.store.record_page(self.scan, 'Y:\\', 0, [self.entry('Y:\\Ofertes', True), self.entry('Y:\\Secret', True)], None)
        self.store.record_page(self.scan, 'Y:\\Ofertes', 0,
                               [self.entry('Y:\\Ofertes\\Pressupost Àlpha.pdf'), self.entry('Y:\\Ofertes\\program.exe')], None)
        self.store.record_page(self.scan, 'Y:\\Secret', 0, [self.entry('Y:\\Secret\\private.txt')], None)
        self.target = self.root / 'map'
        self.build()

    def entry(self, source, directory=False):
        return {'source': source, 'directory': directory, 'bytes': 20, 'modifiedUtc': '2026-09-02T00:00:00Z'}

    def build(self):
        binding, allowed = mapping.policy(self.manifest, files)
        return mapping.build(self.root / 'operator', self.target, self.manifest, binding, allowed)

    def search(self, query, limit=50):
        return mapping.cached_search(self.manifest, query, limit, files, self.target)

    def test_names_paths_accents_and_unsupported_files_without_content(self):
        self.assertEqual(len(self.search('ofertes alpha')['results']), 1)
        self.assertEqual(self.search('program.exe')['results'][0]['kind'], 'file')
        self.assertTrue(self.search('missing')['limited'])
        self.assertFalse(self.search('missing')['sourceChecked'])
        with sqlite3.connect(self.target / 'catalogue.sqlite3') as db:
            self.assertEqual({r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}, {'entries', 'metadata'})
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM chunks').fetchone()[0], 0)

    def test_directory_pagination_and_unknown_path_fallback(self):
        first = self.search('server:/Y/Ofertes', 1)
        self.assertTrue(first['truncated'])
        second = self.search(first['nextQuery'], 1)
        self.assertNotEqual(first['results'][0]['path'], second['results'][0]['path'])
        self.assertIsNone(second['nextQuery'])
        self.assertIsNone(self.search('server:/Y/NotMapped'))
        self.assertEqual(len(self.search('server:/')['results']), 1)

    def test_policy_change_cannot_reuse_old_map_or_reveal_denied_rows(self):
        self.access['readRoots'] = ['Y:\\Ofertes']
        self.assertIsNone(self.search('private'))
        self.build()
        self.assertEqual(self.search('private')['results'], [])
        with self.assertRaises(ValueError):
            self.search('server:/Y/Secret')

    def test_withdrawn_and_denied_descendants_are_not_projected(self):
        self.store.withdraw('Y:\\Secret\\private.txt', 'ACCESS_REVOKED')
        self.store.db.execute("UPDATE directories SET reason='SOURCE_ACCESS_DENIED',state='incomplete' WHERE source_key=?", ('y:\\secret',))
        self.store.db.commit()
        self.build()
        self.assertEqual(self.search('secret')['results'], [])

    def test_identity_and_symlink_boundaries(self):
        with self.assertRaisesRegex(ValueError, 'MAP_IDENTITY_MISMATCH'):
            mapping.cached_search({**self.manifest, 'installationId': 'other'}, 'alpha', 50, files, self.target)
        link = self.root / 'link'; link.symlink_to(self.target)
        with self.assertRaisesRegex(ValueError, 'UNSAFE_MAP_PATH'):
            mapping.cached_search(self.manifest, 'alpha', 50, files, link)

    def test_rebuild_preserves_entry_time_and_generates_bounded_factual_guides(self):
        first = self.search('alpha')['results'][0]['observedAt']
        self.build()
        self.assertEqual(self.search('alpha')['results'][0]['observedAt'], first)
        self.assertIn('pendiente de confirmar', (self.target / 'README.md').read_text())
        self.assertEqual((self.target / 'catalogue.sqlite3').stat().st_mode & 0o777, 0o600)
        self.assertTrue(list((self.target / 'folders').glob('*.md')))

    def test_query_is_literal_data_and_does_not_execute_sql(self):
        self.assertEqual(self.search("' OR 1=1 --")['results'], [])
        self.assertEqual(self.search('%')['results'], [])

    def test_schedule_has_only_metadata_source_operations(self):
        unit = (INFRA / 'aibrain-arnall-knowledge-inventory.service').read_text()
        self.assertIn('knowledge-inventory.py', unit)
        self.assertIn('knowledge-map.py', unit)
        for forbidden in ('knowledge-ingest.py', 'knowledge-reconcile.py', 'knowledge-publish.py'):
            self.assertNotIn(forbidden, unit)


if __name__ == '__main__':
    unittest.main()
