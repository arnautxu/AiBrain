#!/usr/bin/env python3
"""Host operator entry point. Preview is the default; execution is explicit."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


policy_module = module('run_policy', 'knowledge-generation-policy.py')
scheduler = module('run_scheduler', 'knowledge-generation-scheduler.py')
codex = module('run_codex', 'knowledge-codex-adapter.py')
require = policy_module.require


def run(config_path, execute=False):
    require(os.geteuid() == 0, 'HOST_OPERATOR_REQUIRED')
    value = policy_module.private_json(config_path)
    require(isinstance(value, dict) and set(value) == {'schemaVersion', 'manifest', 'bindings', 'policy',
        'codexBinary', 'employeeId', 'chatgptAccountId', 'maxSteps', 'maxDailyCalls', 'seconds'}
        and type(value['schemaVersion']) is int and value['schemaVersion'] == 1, 'INVALID_GENERATION_CONFIG')
    require(isinstance(value['employeeId'], str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}', value['employeeId'])
            and isinstance(value['chatgptAccountId'], str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}', value['chatgptAccountId']),
            'INVALID_CODEX_CONNECTION_BINDING')
    manifest = policy_module.files.sync.load_manifest(value['manifest'])
    policy = policy_module.GenerationPolicy(Path('/var/lib/aibrain/knowledge') / manifest['installationId'],
        manifest, value['bindings'], value['policy'])
    auth_path = Path(manifest['dataRootHost']) / 'users' / value['employeeId'] / 'runtime/codex-home/auth.json'
    adapter = codex.CodexAdapter(value['codexBinary'],
        lambda: codex.access_token(auth_path, value['chatgptAccountId'], manifest['appUid']))
    # Preview does not read an employee token or start Codex. Only explicit grants
    # are considered, and each step rechecks source, audience, version and expiry.
    return scheduler.sweep(policy, adapter, max_steps=value['maxSteps'], max_daily_calls=value['maxDailyCalls'],
                           seconds=value['seconds'], preview=not execute)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(run(args.config, args.execute)))
    except Exception:
        print(json.dumps({'status': 'unavailable', 'error': 'GENERATION_RUN_UNAVAILABLE'}))
        raise SystemExit(1)
