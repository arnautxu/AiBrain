#!/usr/bin/env python3
"""Short, policy-revalidated RDP sessions for read-only inventory pages."""
import datetime as dt
import fcntl
import importlib.util
from pathlib import Path
import secrets
import sys
import time

spec = importlib.util.spec_from_file_location('listing_files', Path(__file__).with_name('rdp-server-files.py'))
files = importlib.util.module_from_spec(spec)
spec.loader.exec_module(files)
require = files.rdp.require


class ListingSession:
    """Reuse up to three listings, retaining the existing nonblocking source lock.

    Twenty seconds is an admission limit, not a command interruption. A current
    command retains its 45-second timeout. No content export or arbitrary command
    is exposed. A transport failure discards the session before another request.
    """
    def __init__(self, manifest, clock=time.monotonic):
        self.manifest = dict(manifest)
        self.clock = clock
        self.session = self.lock = self.binding = None
        self.calls = 0
        self.started = 0
        self.metrics = {'sessions': 0, 'requests': 0, 'startupSeconds': 0, 'executionSeconds': 0}

    def __enter__(self):
        return self

    def close(self, error_type=None, error=None, traceback=None):
        session, lock = self.session, self.lock
        self.session = self.lock = self.binding = None
        try:
            if session is not None:
                session.__exit__(error_type, error, traceback)
        finally:
            if lock is not None:
                lock.close()

    def __exit__(self, *error):
        self.close(*error)

    def __call__(self, manifest, request):
        try:
            require(manifest == self.manifest, 'LISTING_MANIFEST_CHANGED')
            require(isinstance(request, dict) and set(request) == {'mode', 'source', 'offset', 'limit'}
                    and request['mode'] == 'list' and type(request['offset']) is int
                    and 0 <= request['offset'] <= 999999 and request['limit'] == 50
                    and type(request['limit']) is int, 'INVALID_INVENTORY_LISTING')
            files.rdp.select_root(request['source'], manifest['sourceRoots'])
            binding = files.rdp.load_config(manifest['connectionConfig'], manifest['accessManifest'])
            config, credentials, access, destination = binding
            files.rdp.select_root(request['source'], access['readRoots'])
            nonce = secrets.token_hex(16)
            program = files.command(request, access, nonce)
            if self.session is not None and (binding != self.binding or self.calls >= 3
                                             or self.clock() - self.started >= 20):
                self.close()
            if self.session is None:
                self.lock = (destination / '.operator.lock').open('a')
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                job = destination / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + nonce[:12])
                job.mkdir(mode=0o700)
                started = self.clock()
                candidate = files.rdp.RdpSession(config, credentials, access['target'], job)
                # RdpSession cleans partial startup itself; keep our lock cleanup.
                candidate.__enter__()
                self.session, self.binding, self.job = candidate, binding, job
                self.calls, self.started = 0, self.clock()
                self.metrics['sessions'] += 1
                self.metrics['startupSeconds'] += self.clock() - started
            require(files.rdp.load_config(manifest['connectionConfig'], manifest['accessManifest']) == binding,
                    'LISTING_POLICY_CHANGED')
            self.calls += 1
            self.metrics['requests'] += 1
            started = self.clock()
            try:
                result = self.session.execute(program, nonce, timeout=45)
            finally:
                self.metrics['executionSeconds'] += self.clock() - started
            require(isinstance(result, dict) and result.get('nonce') == nonce, 'INVALID_LISTING_NONCE')
            # A changed/revoked policy during the request cannot yield an accepted page.
            require(files.rdp.load_config(manifest['connectionConfig'], manifest['accessManifest']) == binding,
                    'LISTING_POLICY_CHANGED')
            result['recordedAt'] = files.sync.now()
            files.sync.atomic_json(self.job / ('receipt-' + str(self.calls) + '.json'), result)
            # A confirmed path-local rejection is safe to reuse; the inventory
            # still applies its retry cap and defers the path for this invocation.
            require(type(result.get('ok')) is bool, 'INVALID_LISTING_RESPONSE')
            if not result['ok']:
                require(result.get('error') == 'WINDOWS_PATH_UNAVAILABLE', 'INVALID_LISTING_RESPONSE')
                raise PathUnavailable()
            return result
        except PathUnavailable:
            raise ValueError('WINDOWS_PATH_UNAVAILABLE') from None
        except BaseException:
            self.close(*sys.exc_info())
            raise


class PathUnavailable(Exception):
    pass
