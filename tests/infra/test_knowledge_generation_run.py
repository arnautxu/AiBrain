import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('knowledge_run_test', ROOT / 'infra/hetzner/knowledge-generation-run.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunTests(unittest.TestCase):
    def setUp(self):
        self.config = {'schemaVersion': 1, 'manifest': '/private/manifest', 'bindings': '/private/bindings',
            'policy': '/private/policy', 'codexBinary': '/opt/codex', 'employeeId': 'employee-a',
            'chatgptAccountId': 'selected-account', 'maxSteps': 4, 'maxDailyCalls': 32, 'seconds': 240}
        self.manifest = {'installationId': 'company-a', 'connectionId': 'rdp-a',
                         'dataRootHost': '/var/lib/docker/volumes/company-a/_data', 'appUid': 1001}

    def run_with(self, execute=False):
        with patch.object(runner.os, 'geteuid', return_value=0), \
             patch.object(runner.policy_module, 'GenerationPolicy') as policy_class, \
             patch.object(runner.policy_module, 'private_json', return_value=self.config), \
             patch.object(runner.policy_module.files.sync, 'load_manifest', return_value=self.manifest), \
             patch.object(runner.scheduler, 'sweep') as sweep, \
             patch.object(runner.codex, 'access_token', return_value={'fixture': True}) as token:
            runner.run('/private/config', execute)
            token.assert_not_called()
            self.assertEqual(sweep.call_args.kwargs, {'max_steps': 4, 'max_daily_calls': 32, 'seconds': 240, 'preview': not execute})
            policy, adapter = sweep.call_args.args
            self.assertIs(policy, policy_class.return_value)
            policy_class.assert_called_once_with(Path('/var/lib/aibrain/knowledge/company-a'), self.manifest,
                                                  '/private/bindings', '/private/policy')
            adapter.token_supplier()
            token.assert_called_once_with(Path('/var/lib/docker/volumes/company-a/_data/users/employee-a/runtime/codex-home/auth.json'),
                                          'selected-account', 1001)

    def test_default_preview_does_not_read_auth(self): self.run_with()

    def test_execution_preserves_exact_account_installation_and_limits(self): self.run_with(True)

    def test_arbitrary_auth_path_and_employee_traversal_rejected(self):
        for change in ({'authPath': '/other/auth.json'}, {'employeeId': '../other'}, {'chatgptAccountId': ''}):
            with self.subTest(change=change), patch.dict(self.config, change), \
                 patch.object(runner.os, 'geteuid', return_value=0), \
                 patch.object(runner.policy_module, 'private_json', return_value=self.config), \
                 patch.object(runner.scheduler, 'sweep') as sweep:
                with self.assertRaises(ValueError): runner.run('/private/config', True)
                sweep.assert_not_called()

    def test_non_operator_denied_before_config_read(self):
        with patch.object(runner.os, 'geteuid', return_value=1000), patch.object(runner.policy_module, 'private_json') as read:
            with self.assertRaises(ValueError): runner.run('/private/config')
            read.assert_not_called()


if __name__ == '__main__': unittest.main()
