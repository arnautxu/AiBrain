import base64
import importlib.util
import hashlib
from pathlib import Path
import string
import tempfile
import unittest
from unittest.mock import patch

INFRA = Path(__file__).resolve().parents[2] / 'infra/hetzner'
def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, INFRA / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
files = module('server_files', 'rdp-server-files.py')
broker = module('server_broker', 'rdp-server-files-broker.py')


class ServerFileTests(unittest.TestCase):
    def setUp(self):
        self.manifest = {'connectionId': 'arnall', 'installationId': 'test',
                         'sourceRoots': [c + ':\\' for c in string.ascii_uppercase],
                         'publications': [{'scope': 'company', 'scopeId': None}]}

    def test_all_drives_and_unlisted_folders_are_addressable(self):
        for source in ['C:\\Users\\Report.docx', 'Y:\\PRESSUPOSTOS\\2026\\Oferta À.pdf', 'Z:\\Other\\Sheet.xlsx']:
            virtual = files.virtual_path('arnall', source)
            self.assertEqual(files.source_path('arnall', virtual), (source, 1))
        self.assertEqual(files.query_request('server:/', 50)['mode'], 'drives')
        self.assertEqual(files.query_request('Y:/PRESSUPOSTOS', 50)['source'], 'Y:\\PRESSUPOSTOS')

    def test_encoded_paths_cannot_escape_or_select_credentials(self):
        for suffix in ['Y/../x', 'Y/%2e%2e/x', 'Y/a%2fb', 'Y/a%5cb', 'Y/secret.key',
                       'Y/.env', 'Y/abc:stream', 'Y/NUL.txt', 'Y/a?command=whoami']:
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                files.source_path('arnall', 'server-arnall/' + suffix)
        with self.assertRaises(ValueError):
            files.source_path('other', 'server-arnall/Y/file.txt')

    def test_queries_are_data_and_fit_windows_command_limit(self):
        term = "quote'; Write-Output unexpected-command; '"
        request = files.query_request(term, 50)
        command = files.command(request, {'readRoots': self.manifest['sourceRoots']}, 'a'*32)
        self.assertLessEqual(len(command), 7800)
        program = base64.b64decode(command.split()[-1]).decode('utf-16le')
        self.assertNotIn(term, program)
        self.assertIn('ReparsePoint', program)
        self.assertIn('tsclient', program)
        self.assertIn('Elapsed.TotalSeconds-lt15', program)
        self.assertNotIn('Set-Content', program)

    def test_live_directory_page_returns_server_paths_and_continuation(self):
        def run(_, request):
            self.assertEqual(request['source'], 'Y:\\PRESSUPOSTOS')
            self.assertEqual(request['offset'], 50)
            return {'ok': True, 'entries': [{'source': 'Y:\\PRESSUPOSTOS\\Oferta.pdf', 'directory': False,
                    'bytes': 42, 'modifiedUtc': '2026-09-02T00:00:00Z'}], 'nextOffset': 100,
                    'truncated': True, 'recordedAt': '2026-09-02T00:00:00Z'}
        result = files.search(self.manifest, 'server:/Y/PRESSUPOSTOS?offset=50', 50, run)
        self.assertEqual(result['results'][0]['path'], 'server-arnall/Y/PRESSUPOSTOS/Oferta.pdf')
        self.assertTrue(result['limited'])
        self.assertEqual(result['nextQuery'], 'server:/Y/PRESSUPOSTOS?offset=100')

    def test_remote_listing_cannot_inject_another_folder_or_sensitive_path(self):
        def run(*_):
            return {'ok': True, 'entries': [
                {'source': 'Y:\\Other\\file.txt', 'directory': False, 'bytes': 1},
                {'source': 'Y:\\PRESSUPOSTOS\\passwords.txt', 'directory': False, 'bytes': 1}],
                'truncated': False, 'recordedAt': 'now'}
        result = files.search(self.manifest, 'server:/Y/PRESSUPOSTOS', 50, run)
        self.assertEqual(result['results'], [])
        self.assertTrue(result['limited'])

    def test_denied_folders_mean_incomplete_search_not_global_absence(self):
        result = files.search(self.manifest, 'unknown', 50, lambda *_: {
            'ok': True, 'entries': [], 'denied': 1, 'truncated': False, 'recordedAt': 'now'})
        self.assertTrue(result['limited'])
        self.assertIn('No interpretes', result['warning'])

    def test_read_checks_connection_root_and_format_before_remote_call(self):
        def never(*_, **__):
            self.fail('Remote call was not authorized')
        restricted = {**self.manifest, 'sourceRoots': ['Y:\\Approved']}
        for path in ['server-arnall/Y/Other.txt', 'server-other/Y/Approved/a.txt', 'server-arnall/Y/Approved/a.exe']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                files.read(restricted, path, never)

    def test_read_checks_fresh_bytes_before_extracting_and_returns_parts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            original = root / 'payload'
            original.write_bytes(b'source bytes')
            digest = hashlib.sha256(original.read_bytes()).hexdigest()
            manifest = {**self.manifest, 'importsRoot': root, 'maxFileBytes': 16 * 1024 * 1024}
            receipt = {'destination': str(original), 'sha256': digest, 'verifiedSha256': digest,
                       'bytes': original.stat().st_size, 'recordedAt': '2026-09-02T00:00:00Z',
                       'modifiedUtc': '2026-09-01T00:00:00Z'}
            calls = []
            def copy(_, operation, source, attempts):
                calls.append((operation, source, attempts))
                return receipt
            extract = lambda *_: {'ok': True, 'text': 'x' * (120 * 1024 + 5)}
            target = 'server-arnall/Y/PRESSUPOSTOS/Oferta.pdf'
            first = files.read(manifest, target, copy, extract)
            second = files.read(manifest, first['nextPath'], copy, extract)
            self.assertEqual((first['parts'], second['part']), (2, 2))
            self.assertEqual(first['sha256'], second['sha256'])
            self.assertIsNone(second['nextPath'])
            self.assertEqual(calls, [('copy', 'Y:\\PRESSUPOSTOS\\Oferta.pdf', 1)] * 2)
            original.write_bytes(b'changed bytes')
            with self.assertRaisesRegex(ValueError, 'INVALID_SERVER_COPY'):
                files.read(manifest, target, copy, lambda *_: self.fail('Unverified copy was extracted'))

    def test_broker_validates_actor_binding_and_rejects_arbitrary_operations(self):
        valid = {'schemaVersion': 1, 'operation': 'search', 'requestId': '00000000-0000-4000-8000-000000000001',
                 'installationId': 'test', 'connectionId': 'arnall', 'input': {'query': 'server:/Y/PRESSUPOSTOS', 'limit': 50}}
        self.assertTrue(broker.validate_request(valid, self.manifest))
        for changed in [dict(valid, installationId='other'), dict(valid, connectionId='other'),
                        dict(valid, operation='write'), dict(valid, command='whoami'),
                        dict(valid, input={'query': 'server:/Y/../secret', 'limit': 50})]:
            self.assertFalse(broker.validate_request(changed, self.manifest))

    def test_scope_revalidation_precedes_every_file_operation(self):
        value = {'schemaVersion': 1, 'operation': 'read', 'requestId': '00000000-0000-4000-8000-000000000001',
                 'installationId': 'test', 'connectionId': 'arnall', 'input': {'path': 'server-arnall/Y/file.txt'}}
        with patch.object(broker.sync, 'scope_directory', side_effect=ValueError('SCOPE_BINDING_MISMATCH')), \
             patch.object(broker.files, 'read') as reader, self.assertRaisesRegex(ValueError, 'SCOPE_BINDING_MISMATCH'):
            broker.execute(self.manifest, value)
        reader.assert_not_called()

    def test_read_only_service_does_not_expose_docker_or_windows_credentials(self):
        unit = (INFRA / 'aibrain-arnall-server-files.service').read_text()
        self.assertIn('ProtectSystem=strict', unit)
        self.assertIn('KillMode=control-group', unit)
        self.assertIn('RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK', unit)
        self.assertNotIn('docker.sock', unit)
        self.assertNotIn('credentials.env', unit)
        self.assertNotIn('enterprise-documents', unit)

if __name__ == '__main__':
    unittest.main()
