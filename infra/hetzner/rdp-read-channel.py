"""Optional installation-bound live RDPDR channel; disabled without explicit config.

No TCP listener, Windows installation, arbitrary command API or implicit retry.
An uncertain stop leaves a durable quarantine that legacy RDP callers obey.
"""
import base64
import fcntl
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import threading
import time
import uuid


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


files = module('rdp-server-files')
lease = module('rdp-channel-lease')
rdp, sync = files.rdp, files.sync
ERRORS = {'SERVER_FILES_TIMEOUT', 'SERVER_FILES_BUSY', 'SERVER_CHANNEL_QUARANTINED',
          'SERVER_CHANNEL_POLICY_CHANGED', 'WINDOWS_PATH_UNAVAILABLE',
          'SERVER_FORMAT_NOT_READABLE', 'SERVER_SOURCE_CHANGED', 'SERVER_COPY_LIMIT',
          'SERVER_FILES_UNAVAILABLE'}


def pack(value, key):
    payload = json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()
    return json.dumps({'payload': base64.b64encode(payload).decode(),
                      'mac': hmac.new(key, payload, hashlib.sha256).hexdigest()}).encode()


def unpack(raw, key):
    if len(raw) > 256 * 1024:
        raise ValueError('SERVER_FILES_UNAVAILABLE')
    try:
        envelope = json.loads(raw.decode('utf-8-sig'))
        if set(envelope) != {'payload', 'mac'}:
            raise ValueError()
        payload = base64.b64decode(envelope['payload'], validate=True)
        if not hmac.compare_digest(hmac.new(key, payload, hashlib.sha256).hexdigest(), envelope['mac']):
            raise ValueError()
        value = json.loads(payload)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, KeyError, TypeError, UnicodeError):
        raise ValueError('SERVER_FILES_UNAVAILABLE') from None


def fingerprint(config, credentials, access):
    # Secret material is hashed in memory, never returned or logged.
    return hashlib.sha256(json.dumps([config, credentials, access], sort_keys=True).encode()).hexdigest()


def settings(path, manifest):
    data = json.loads(rdp.private_file(path).read_text())
    if set(data) != {'schemaVersion', 'mode', 'installationId', 'connectionId', 'identityEvidenceFile'} or data['schemaVersion'] != 1 or data['mode'] != 'rdpdr':
        raise ValueError('SERVER_CHANNEL_CONFIG_INVALID')
    if any(data[k] != manifest[k] for k in ('installationId', 'connectionId')):
        raise ValueError('SERVER_CHANNEL_CONFIG_INVALID')
    config, credentials, access, destination = rdp.load_config(manifest['connectionConfig'], manifest['accessManifest'])
    evidence = json.loads(rdp.private_file(data['identityEvidenceFile']).read_text())
    required = {'installationId', 'connectionId', 'accountSid', 'dedicatedSession', 'readOnlyAclVerified', 'policyFingerprint', 'assessmentId'}
    if set(evidence) != required or any(evidence[k] != manifest[k] for k in ('installationId', 'connectionId')) or evidence['dedicatedSession'] is not True or evidence['readOnlyAclVerified'] is not True or not re.fullmatch(r'S-1-5-(?:[0-9]+-){1,12}[0-9]+', evidence['accountSid']) or not isinstance(evidence['assessmentId'], str) or not 1 <= len(evidence['assessmentId']) <= 500 or evidence['policyFingerprint'] != fingerprint(config, credentials, access):
        raise ValueError('SERVER_CHANNEL_IDENTITY_UNVERIFIED')
    return config, credentials, access, destination, evidence['accountSid']


class Session:
    def __init__(self, manifest, validated):
        self.manifest = manifest
        self.config, self.credentials, self.access, self.root, self.sid = validated
        self.key, self.nonce = secrets.token_bytes(32), secrets.token_hex(16)
        self.job = self.root / ('channel-' + self.nonce)
        self.connection = None
        self.lock = None
        self.confirmed = False
        self.started = time.monotonic()
        self.request_lock = threading.Lock()
        self.requests = 0
        self.dead = False
        self.failed = False

    def start(self):
        self.lock = (self.root / '.operator.lock').open('a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if lease.read(self.root) is not None:
                raise ValueError('SERVER_CHANNEL_QUARANTINED')
            self.job.mkdir(mode=0o700)
            lease.acquire(self.root, self.job.name, self.nonce)
            program = Path(__file__).with_suffix('.ps1').read_text()
            program = program.replace('__KEY__', base64.b64encode(self.key).decode()).replace('__ROOTS__', base64.b64encode(json.dumps(self.access['readRoots']).encode()).decode()).replace('__NONCE__', self.nonce).replace('__MAX_BYTES__', str(self.access['maxFileBytes'])).replace('__SID__', self.sid)
            script = self.job / 'bridge.ps1'
            self.write(script, program.encode())
            digest = hashlib.sha256(script.read_bytes()).hexdigest()
            bootstrap = "$ErrorActionPreference='Stop';$until=[DateTime]::UtcNow.AddSeconds(20);while(!(Test-Path -LiteralPath '\\\\tsclient\\AiBrain\\bridge.ps1')){if([DateTime]::UtcNow-ge$until){throw 'ChannelUnavailable'};Start-Sleep -Milliseconds 100};$b=[IO.File]::ReadAllBytes('\\\\tsclient\\AiBrain\\bridge.ps1');$h=[Security.Cryptography.SHA256]::Create();$s=([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLower();if($s-ne'" + digest + "'){throw 'Hash'};&([scriptblock]::Create([Text.Encoding]::UTF8.GetString($b)))"
            command = 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' + base64.b64encode(bootstrap.encode('utf-16le')).decode()
            self.connection = rdp.RdpSession(self.config, self.credentials, self.access['target'], self.job)
            self.connection.__enter__()
            publisher = subprocess.Popen(['xclip', '-selection', 'clipboard', '-in', '-quiet'], env=self.connection.env,
                                         stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.connection.processes.append(publisher)
            publisher.stdin.write(command.encode('ascii'))
            publisher.stdin.close()
            time.sleep(.7)
            self.connection.key('ctrl+v')
            time.sleep(1)
            self.connection.key('Return')
            value = self.wait('ready.json', 30)
            if value.get('nonce') != self.nonce or value.get('state') != 'ready' or value.get('accountSid') != self.sid or value.get('administrator') is not False:
                raise ValueError('SERVER_CHANNEL_IDENTITY_UNVERIFIED')
            self.started = time.monotonic()
            return self
        except BaseException:
            self.close()
            raise

    @staticmethod
    def write(path, raw):
        with Path(path).open('xb', opener=lambda p, flags: os.open(p, flags, 0o600)) as file:
            file.write(raw)
            file.flush()
            os.fsync(file.fileno())

    def wait(self, name, timeout):
        deadline = time.monotonic() + timeout
        path = self.job / name
        while time.monotonic() < deadline:
            try:
                info = path.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 256 * 1024:
                    raise ValueError('SERVER_FILES_UNAVAILABLE')
                return unpack(path.read_bytes(), self.key)
            except FileNotFoundError:
                pass
            except ValueError:
                # Signed files are published atomically except ready/done, whose
                # incomplete writes may be observed. Never accept an invalid MAC.
                if name not in ('ready.json', 'done.json'):
                    raise
            time.sleep(.025)
        raise ValueError('SERVER_FILES_TIMEOUT')

    def send(self, request):
        identifier = uuid.uuid4().hex
        value = {**request, 'id': identifier, 'session': self.nonce}
        raw = pack(value, self.key)
        if len(raw) > 8192:
            raise ValueError('SERVER_FILES_UNAVAILABLE')
        temporary = self.job / ('request-' + identifier + '.tmp')
        self.write(temporary, raw)
        temporary.rename(self.job / ('request-' + identifier + '.json'))
        return identifier

    def request(self, request):
        with self.request_lock:
            if self.dead or self.requests >= 110 or time.monotonic() - self.started > 50:
                raise ValueError('SERVER_FILES_BUSY')
            self.requests += 1
            identifier = self.send(request)
        result = self.wait('response-' + identifier + '.json', 35)
        if result.get('id') != identifier:
            raise ValueError('SERVER_FILES_UNAVAILABLE')
        if result.get('ok') is not True:
            code = result.get('error')
            raise ValueError(code if code in ERRORS else 'SERVER_FILES_UNAVAILABLE')
        result['recordedAt'] = sync.now()
        if request['mode'] == 'copy':
            payload = self.job / ('copy-' + identifier)
            info = payload.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > self.access['maxFileBytes'] or result.get('source') != request['source'] or type(result.get('bytes')) is not int or result['bytes'] != info.st_size or hashlib.sha256(payload.read_bytes()).hexdigest() != result.get('sha256'):
                raise ValueError('SERVER_FILES_UNAVAILABLE')
            payload.chmod(0o600)
            result.update(destination=str(payload), verifiedSha256=result['sha256'])
        return result

    def close(self):
        if self.dead:
            return
        self.dead = True
        try:
            if self.connection is not None and hasattr(self.connection, 'rdp') and self.connection.rdp.poll() is None:
                self.send({'mode': 'stop'})
                done = self.wait('done.json', 10)
                self.confirmed = done.get('state') == 'stopped' and done.get('nonce') == self.nonce
        except (ValueError, OSError):
            pass
        finally:
            try:
                if self.connection is not None and hasattr(self.connection, 'temp'):
                    # Never type exit into an unconfirmed remote state.
                    self.connection.__exit__(None if self.confirmed else RuntimeError, None, None)
            finally:
                try:
                    if self.confirmed:
                        lease.release(self.root, self.job.name, self.nonce)
                finally:
                    if self.lock:
                        self.lock.close()


class Channel:
    def __init__(self, path, manifest, factory=Session):
        self.path, self.manifest, self.factory = path, manifest, factory
        self.validated = settings(path, manifest)
        self.initial = fingerprint(*self.validated[:3])
        self.guard = threading.Lock()
        self.slots = threading.BoundedSemaphore(4)
        self.active, self.session, self.last_use = 0, None, 0
        self.stopped = threading.Event()
        self.timer = threading.Thread(target=self.reap, daemon=True)
        self.timer.start()

    def check(self):
        current = settings(self.path, self.manifest)
        if fingerprint(*current[:3]) != self.initial or current[4] != self.validated[4]:
            raise ValueError('SERVER_CHANNEL_POLICY_CHANGED')
        for audience in self.manifest['publications']:
            sync.scope_directory(self.manifest, audience)

    def call(self, request):
        if request.get('mode') not in ('drives', 'list', 'copy'):
            raise ValueError('SERVER_FILES_UNAVAILABLE')
        if request.get('source'):
            rdp.select_root(request['source'], self.manifest['sourceRoots'])
            rdp.select_root(request['source'], self.validated[2]['readRoots'])
        if request['mode'] == 'copy' and Path(request['source']).suffix.lower() not in sync.FORMATS:
            raise ValueError('SERVER_FORMAT_NOT_READABLE')
        if not self.slots.acquire(blocking=False):
            raise ValueError('SERVER_FILES_BUSY')
        entered = False
        try:
            with self.guard:
                self.check()
                if self.stopped.is_set():
                    raise ValueError('SERVER_FILES_UNAVAILABLE')
                if self.session is not None and (self.session.failed or time.monotonic() - self.session.started > 50):
                    if self.active:
                        raise ValueError('SERVER_FILES_BUSY')
                    self.session.close()
                    self.session = None
                if self.session is None:
                    self.session = self.factory(self.manifest, self.validated).start()
                self.active += 1
                entered = True
                session = self.session
            # No retry or fallback after dispatch, including read-only requests.
            try:
                return session.request(request)
            except (ValueError, OSError) as error:
                if str(error) not in {'WINDOWS_PATH_UNAVAILABLE', 'SERVER_SOURCE_CHANGED', 'SERVER_COPY_LIMIT', 'SERVER_FORMAT_NOT_READABLE', 'SERVER_FILES_BUSY'}:
                    with self.guard:
                        session.failed = True
                raise
        finally:
            try:
                if entered:
                    with self.guard:
                        self.active -= 1
                        self.last_use = time.monotonic()
                        if not self.active and session.failed:
                            self.session = None
                            session.close()
            finally:
                self.slots.release()

    def browse(self, manifest, request):
        if any(manifest[k] != self.manifest[k] for k in ('installationId', 'connectionId')):
            raise ValueError('SERVER_FILES_UNAVAILABLE')
        return self.call(request)

    def copy(self, manifest, operation, source, attempts=1):
        if operation != 'copy' or attempts != 1 or any(manifest[k] != self.manifest[k] for k in ('installationId', 'connectionId')):
            raise ValueError('SERVER_FILES_UNAVAILABLE')
        return self.call({'mode': 'copy', 'source': source})

    def reap(self):
        while not self.stopped.wait(1):
            with self.guard:
                if self.session is not None and not self.active and time.monotonic() - self.last_use > 15:
                    self.session.close()
                    self.session = None

    def close(self):
        self.stopped.set()
        with self.guard:
            if self.session is not None and not self.active:
                self.session.close()
                self.session = None


def recover_stopped(manifest):
    """Clear only our marker, after an authenticated remote finalizer receipt.

    Does not connect to Windows, kill a session, remove a customer file or trust
    elapsed time. Intended for root recovery after the broker process crashed.
    """
    _, _, _, root = rdp.load_config(manifest['connectionConfig'], manifest['accessManifest'])
    with (root / '.operator.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        value = lease.read(root)
        if value is None:
            return False
        job = root / value['job']
        sync.secure_dir(job)
        program = rdp.private_file(job / 'bridge.ps1').read_text()
        match = re.search(r"\$key=\[Convert\]::FromBase64String\('([A-Za-z0-9+/=]+)'\)", program)
        if match is None:
            raise ValueError('SERVER_CHANNEL_QUARANTINED')
        done_path = job / 'done.json'
        info = done_path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('SERVER_CHANNEL_QUARANTINED')
        done = unpack(done_path.read_bytes(), base64.b64decode(match[1], validate=True))
        if done.get('state') != 'stopped' or done.get('nonce') != value['nonce']:
            raise ValueError('SERVER_CHANNEL_QUARANTINED')
        lease.release(root, value['job'], value['nonce'])
        return True


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--recover-stopped', action='store_true', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('HOST_OPERATOR_REQUIRED')
    print(json.dumps({'recovered': recover_stopped(sync.load_manifest(args.manifest))}))
