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
        context = self.search('Ofertes')['results'][0]['folderContext']
        self.assertEqual(context['businessPurpose'], 'unconfirmed')
        self.assertEqual(context['observedFileTypes'], {'.pdf': 1, '.exe': 1})
        self.assertTrue(context['partial'])

    def test_guides_include_second_drive_when_first_drive_has_many_folders(self):
        with sqlite3.connect(self.target/'catalogue.sqlite3') as db:
            for n in range(140):
                source = 'C:\\System'+str(n)
                db.execute('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?)',(source.lower(),source,'c:',source[3:],'directory','',0,None,'2026-09-02T00:00:00Z','pending',source.lower()))
            meta = json.loads(db.execute('SELECT value FROM metadata').fetchone()[0])
        mapping.write_guides(self.target,meta)
        guide=(self.target/'README.md').read_text()
        self.assertIn('Y:',guide)
        self.assertIn('Ofertes',guide)

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

    def test_pending_folder_uses_live_listing_instead_of_empty_cache(self):
        self.store.db.execute("UPDATE directories SET state='pending' WHERE source_key='y:\\ofertes'")
        self.store.db.commit()
        self.build()
        self.assertIsNone(self.search('server:/Y/Ofertes'))

    def test_inventory_counts_whole_subtree_not_just_page_and_preserves_unknowns(self):
        self.store.db.execute("UPDATE directories SET state='pending',offset=0 WHERE source_key='y:\\ofertes'")
        self.store.db.commit()
        entries = [self.entry('Y:\\Ofertes\\file'+str(n)+'.pdf') for n in range(49)] + [self.entry('Y:\\Ofertes\\Child', True)]
        self.store.record_page(self.scan, 'Y:\\Ofertes', 0, entries, 50)
        self.store.record_page(self.scan, 'Y:\\Ofertes', 50, [self.entry('Y:\\Ofertes\\last.jpg')], None)
        self.build()
        result = mapping.folder_inventory(self.manifest, 'server-fictional/Y/Ofertes', 0, files, self.target)
        self.assertEqual(result['fileCount'], 52)  # includes two earlier observations
        self.assertEqual(len(result['results']), 50)
        self.assertEqual(result['nextOffset'], 50)
        self.assertFalse(result['enumerationComplete'])
        self.assertIsNone(result['businessRecordCount'])
        self.store.record_page(self.scan, 'Y:\\Ofertes\\Child', 0, [self.entry('Y:\\Ofertes\\Child\\nested.pdf')], None)
        self.build()
        second = mapping.folder_inventory(self.manifest, 'server-fictional/Y/Ofertes', 50, files, self.target)
        self.assertEqual(second['fileCount'], 53)
        self.assertEqual(len(second['results']), 3)
        self.assertTrue(second['enumerationComplete'])
        self.assertFalse(second['sourceChecked'])
        self.assertFalse(second['snapshot'])
        self.assertEqual(second['fileTypes']['.pdf'], 51)

    def test_inventory_known_empty_unknown_and_denied_are_distinct(self):
        self.store.db.execute('INSERT INTO directories(scan,source_key,source) VALUES(?,?,?)', (self.scan, 'y:\\empty', 'Y:\\Empty'))
        self.store.db.commit()
        self.store.record_page(self.scan, 'Y:\\Empty', 0, [], None)
        self.build()
        empty = mapping.folder_inventory(self.manifest, 'server-fictional/Y/Empty', 0, files, self.target)
        self.assertEqual(empty['fileCount'], 0)
        self.assertTrue(empty['enumerationComplete'])
        self.assertIsNone(mapping.folder_inventory(self.manifest, 'server-fictional/Y/Missing', 0, files, self.target))
        with self.assertRaises(ValueError):
            mapping.folder_inventory(self.manifest, 'server-fictional/Y/Ofertes?part=1', 0, files, self.target)
        self.store.db.execute("UPDATE directories SET reason='SOURCE_ACCESS_DENIED',state='incomplete' WHERE source_key='y:\\secret'")
        self.store.db.commit()
        self.build()
        root = mapping.folder_inventory(self.manifest, 'server-fictional/Y/', 0, files, self.target)
        self.assertFalse(root['enumerationComplete'])
        self.assertEqual(root['fileCount'], 2)
        with self.assertRaises(ValueError):
            mapping.folder_inventory(self.manifest, 'server-fictional/Y/Secret', 0, files, self.target)
        self.access['readRoots'] = ['Y:\\Secret']
        with self.assertRaises(ValueError):
            mapping.folder_inventory(self.manifest, 'server-fictional/Y/Ofertes', 0, files, self.target)

    def test_demand_fill_resumes_only_target_and_never_content(self):
        demand = load('test_folder_demand', 'knowledge-folder-inventory.py')
        self.store.db.execute("UPDATE directories SET state='pending',offset=0")
        self.store.db.commit()
        requests = []
        def run(_, request):
            requests.append(request)
            offset = request['offset']
            return {'ok': True, 'entries': [self.entry('Y:\\Ofertes\\item'+str(n)+'.txt') for n in range(offset, offset+50)],
                    'truncated': True, 'nextOffset': offset+50}
        result = demand.fill(self.store, self.manifest, self.scan, 'Y:\\Ofertes', run)
        self.assertEqual(result, {'pagesRead': 2, 'state': 'CONTINUE'})
        self.assertEqual([r['offset'] for r in requests], [0, 50])
        self.assertTrue(all(r['source'] == 'Y:\\Ofertes' and r['mode'] == 'list' for r in requests))
        self.assertEqual(demand.next_directory(self.store, self.scan, 'Y:\\Ofertes')['offset'], 100)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM chunks').fetchone()[0], 0)
        busy = demand.fill(self.store, self.manifest, self.scan, 'Y:\\Ofertes', lambda *_: (_ for _ in ()).throw(BlockingIOError()))
        self.assertEqual(busy, {'pagesRead': 0, 'state': 'SOURCE_BUSY'})
        self.assertEqual(demand.next_directory(self.store, self.scan, 'Y:\\Ofertes')['attempts'], 0)
        self.assertIsNone(demand.next_directory(self.store, self.scan, 'Y:\\Oferte'))

    def test_background_yields_between_pages_and_expired_marker_is_ignored(self):
        demand = load('test_folder_yield', 'knowledge-folder-inventory.py')
        import time
        marker = self.root / 'operator' / 'interactive-until'
        mapping.atomic_text(marker, str(time.time()+100))
        self.assertTrue(demand.inventory.demand_pending(marker.parent))
        result = demand.inventory.run_batch(self.store, self.manifest, self.scan,
                    run=lambda *_: self.fail('Background did not yield'), should_yield=lambda: True)
        self.assertEqual(result['paused'], 'INTERACTIVE_REQUEST')
        mapping.atomic_text(marker, '0')
        self.assertFalse(demand.inventory.demand_pending(marker.parent))

    def test_schedule_has_only_metadata_source_operations(self):
        unit = (INFRA / 'aibrain-arnall-knowledge-inventory.service').read_text()
        self.assertIn('knowledge-inventory.py', unit)
        self.assertIn('knowledge-map.py', unit)
        for forbidden in ('knowledge-ingest.py', 'knowledge-reconcile.py', 'knowledge-publish.py'):
            self.assertNotIn(forbidden, unit)


if __name__ == '__main__':
    unittest.main()
