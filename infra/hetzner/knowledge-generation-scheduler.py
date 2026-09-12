"""Sequential fair scheduling of explicitly granted jobs, with durable budgets.

No discovery, preparation, permission creation or provider selection. A caller
supplies the accepted model adapter. Each reservation counts even after a crash.
"""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import time
import uuid


def require(condition, code):
    if not condition:
        raise ValueError(code)


def private_file(path, flags):
    fd = os.open(path, flags | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if not (stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid() and not info.st_mode & 0o077):
        os.close(fd)
        raise ValueError('PRIVATE_SCHEDULER_FILE_REQUIRED')
    return fd


def write_state(root, value):
    temporary = root / ('.state-' + uuid.uuid4().hex)
    try:
        with os.fdopen(private_file(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'w') as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, root / 'state.json')
        fd = os.open(root, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


def read_state(root, installation, today):
    path = root / 'state.json'
    try:
        with os.fdopen(private_file(path, os.O_RDONLY), 'rb') as source:
            raw = source.read(4097)
        require(len(raw) <= 4096, 'INVALID_SCHEDULER_STATE')
        state = json.loads(raw)
    except FileNotFoundError:
        return {'schemaVersion': 1, 'installationId': installation, 'cursor': None, 'day': today, 'reservations': 0}
    require(isinstance(state, dict) and set(state) == {'schemaVersion', 'installationId', 'cursor', 'day', 'reservations'}
            and type(state['schemaVersion']) is int and state['schemaVersion'] == 1
            and state['installationId'] == installation and type(state['reservations']) is int and state['reservations'] >= 0
            and (state['cursor'] is None or isinstance(state['cursor'], str) and re.fullmatch('[a-f0-9]{64}', state['cursor']))
            and isinstance(state['day'], str), 'INVALID_SCHEDULER_STATE')
    require(dt.date.fromisoformat(state['day']).isoformat() == state['day'], 'INVALID_SCHEDULER_DAY')
    # Clock rollback must not reset a consumed budget.
    if today > state['day']:
        state.update(day=today, reservations=0)
    return state


def sweep(policy, adapter, *, max_steps=4, max_daily_calls=32, seconds=240, monotonic=time.monotonic, day=None, preview=False):
    require(type(max_steps) is int and 1 <= max_steps <= 32, 'INVALID_SCHEDULER_STEPS')
    require(type(max_daily_calls) is int and 1 <= max_daily_calls <= 256, 'INVALID_SCHEDULER_BUDGET')
    require(type(seconds) is int and 1 <= seconds <= 900, 'INVALID_SCHEDULER_SECONDS')
    snapshot = policy.snapshot()
    require(adapter.model_key == snapshot['modelKey'], 'GENERATION_ADAPTER_MISMATCH')
    jobs = sorted(grant['jobId'] for grant in snapshot['grants'])
    report = {'status': 'preview' if preview else 'idle', 'eligible': len(jobs), 'visited': 0, 'dispatched': 0,
              'complete': 0, 'blocked': 0, 'denied': 0, 'deferred': 0}
    if preview:
        for job in jobs:
            try:
                policy.permission(job)
                report['visited'] += 1
            except Exception:
                report['denied'] += 1
        return report
    # Canonical, owner-only directory; never follow a symlink for state or lock.
    root = policy.root / 'generation-runtime'
    root.mkdir(mode=0o700, exist_ok=True)
    info = root.lstat()
    require(stat.S_ISDIR(info.st_mode) and not root.is_symlink() and root == root.resolve()
            and info.st_uid == os.geteuid() and not info.st_mode & 0o077, 'PRIVATE_SCHEDULER_ROOT_REQUIRED')
    with os.fdopen(private_file(root / 'scheduler.lock', os.O_RDWR | os.O_CREAT), 'r+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            report['status'] = 'busy'
            return report
        today = day or dt.datetime.now(dt.timezone.utc).date().isoformat()
        require(dt.date.fromisoformat(today).isoformat() == today, 'INVALID_SCHEDULER_DAY')
        state = read_state(root, policy.manifest['installationId'], today)
        cursor = state['cursor']
        if cursor:
            jobs = [job for job in jobs if job > cursor] + [job for job in jobs if job <= cursor]
        started = monotonic()

        class BudgetAdapter:
            model_key = adapter.model_key

            def generate(self, request, request_key, timeout_seconds):
                require(state['reservations'] < max_daily_calls, 'GENERATION_BUDGET_EXHAUSTED')
                state['reservations'] += 1
                # Reserve before dispatch. Never refund uncertain attempts.
                write_state(root, state)
                report['dispatched'] += 1
                return adapter.generate(request, request_key, timeout_seconds)

        for job in jobs:
            if report['visited'] >= max_steps or monotonic() - started >= seconds or state['reservations'] >= max_daily_calls:
                report['status'] = 'budget-limited'
                break
            # Advance the durable cursor even for denied/blocked jobs, so one
            # stale grant cannot starve other company/private partitions.
            state['cursor'] = job
            write_state(root, state)
            report['visited'] += 1
            try:
                result = policy.run_step(job, BudgetAdapter())
                if result['state'] in {'complete', 'blocked'}:
                    report[result['state']] += 1
                elif result['state'] in {'running', 'retry'}:
                    report['deferred'] += 1
            except Exception:
                # Source paths, document content and arbitrary exceptions are
                # excluded from the operator's aggregate status output.
                report['denied'] += 1
            report['status'] = 'processed'
        return report
