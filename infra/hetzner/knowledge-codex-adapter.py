"""One ephemeral, tool-free Codex App Server process per semantic step.

The trusted host supplies only a current access token from the selected existing
connection. No refresh token, existing CODEX_HOME, employee context or source
directory enters the sandbox. This module neither logs in nor refreshes a login.
"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time

spec = importlib.util.spec_from_file_location('knowledge_codex_settings', Path(__file__).with_name('knowledge-codex-config.py'))
settings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(settings)


def require(ok, code):
    if not ok:
        raise ValueError(code)


def open_absolute(path, trusted_binary=False):
    """Walk every directory without following symlinks, including race swaps."""
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'CODEX_PATH_UNSAFE')
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parts[1:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
            if trusted_binary:
                info = os.fstat(directory)
                require(info.st_uid == 0 and not info.st_mode & 0o022, 'CODEX_BINARY_PARENT_UNSAFE')
        return os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    finally:
        os.close(directory)


def access_token(path, account_id, owner_uid, now=None):
    """Read-only snapshot; never return refresh/id tokens or raw errors."""
    try:
        path = Path(path)
        require(path.is_absolute() and path == path.resolve(), 'CODEX_AUTH_PATH_UNSAFE')
        fd = open_absolute(path)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                    and info.st_uid == owner_uid and not info.st_mode & 0o077, 'CODEX_AUTH_FILE_UNSAFE')
            raw = source.read(65537)
        require(len(raw) <= 65536, 'CODEX_AUTH_TOO_LARGE')
        tokens = json.loads(raw)['tokens']
        token = tokens['access_token']
        require(tokens['account_id'] == account_id and isinstance(token, str) and len(token) <= 32768,
                'CODEX_ACCOUNT_MISMATCH')
        payload = token.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        require(type(claims['exp']) in (int, float) and claims['exp'] > (time.time() if now is None else now) + 120,
                'CODEX_ACCESS_TOKEN_EXPIRED')
        return {'type': 'chatgptAuthTokens', 'accessToken': token, 'chatgptAccountId': account_id}
    except Exception:
        raise ValueError('CODEX_CONNECTION_UNAVAILABLE') from None


def output_schema(part):
    reference = {'type': 'object', 'properties': (
        {'unitId': {'type': 'string'}, 'quote': {'type': 'string'}} if part else
        {'partId': {'type': 'string'}, 'claimIndex': {'type': 'integer'}}),
        'required': ['unitId', 'quote'] if part else ['partId', 'claimIndex'], 'additionalProperties': False}
    key = 'citations' if part else 'references'
    claim = {'type': 'object', 'properties': {'text': {'type': 'string'}, key: {'type': 'array', 'items': reference}},
             'required': ['text', key], 'additionalProperties': False}
    return {'type': 'object', 'properties': {'claims': {'type': 'array', 'items': claim}},
            'required': ['claims'], 'additionalProperties': False}


class Rpc:
    """Bounded NDJSON transport; unknown server requests fail closed."""
    def __init__(self, process, deadline):
        self.process, self.deadline, self.sequence = process, deadline, 0
        self.buffer, self.total = b'', 0
        self.events = []
        self.selector = selectors.DefaultSelector()
        self.selector.register(process.stdout, selectors.EVENT_READ)
        os.set_blocking(process.stdin.fileno(), False)

    def close(self):
        self.selector.close()

    def send(self, value):
        payload = json.dumps(value, ensure_ascii=False).encode() + b'\n'
        with selectors.DefaultSelector() as writable:
            writable.register(self.process.stdin, selectors.EVENT_WRITE)
            while payload:
                require(time.monotonic() < self.deadline, 'CODEX_TIMEOUT')
                require(writable.select(max(0, self.deadline - time.monotonic())), 'CODEX_TIMEOUT')
                try:
                    size = os.write(self.process.stdin.fileno(), payload)
                    payload = payload[size:]
                except BlockingIOError:
                    pass

    def receive(self):
        while b'\n' not in self.buffer:
            require(time.monotonic() < self.deadline, 'CODEX_TIMEOUT')
            require(self.selector.select(max(0, self.deadline - time.monotonic())), 'CODEX_TIMEOUT')
            chunk = os.read(self.process.stdout.fileno(), 65536)
            require(chunk, 'CODEX_PROCESS_ENDED')
            self.total += len(chunk)
            self.buffer += chunk
            require(self.total <= 4 * 1024 * 1024 and len(self.buffer) <= 512 * 1024, 'CODEX_STREAM_TOO_LARGE')
        line, self.buffer = self.buffer.split(b'\n', 1)
        message = json.loads(line)
        require(isinstance(message, dict), 'CODEX_INVALID_MESSAGE')
        # Includes approvals, dynamic tools and auth refresh. Never fulfill them.
        require(not ('id' in message and 'method' in message), 'CODEX_SERVER_REQUEST_DENIED')
        return message

    def call(self, method, params):
        self.sequence += 1
        identifier = self.sequence
        self.send({'id': identifier, 'method': method, 'params': params})
        while True:
            message = self.receive()
            if message.get('id') == identifier:
                require('result' in message and 'error' not in message, 'CODEX_RPC_FAILED')
                return message['result']
            # A turn may finish before its start response; callers need these.
            self.events.append(message)

    def event(self):
        return self.events.pop(0) if self.events else self.receive()


def exchange(process, request, login, deadline):
    rpc = Rpc(process, deadline)
    try:
        rpc.call('initialize', {'clientInfo': {'name': 'aibrain_knowledge', 'version': '1.0.0'},
                                'capabilities': {'experimentalApi': True}})
        rpc.send({'method': 'initialized'})
        rpc.call('account/login/start', login)
        started = rpc.call('thread/start', {'model': settings.MODEL, 'modelProvider': 'knowledge_codex',
            'allowProviderModelFallback': False, 'cwd': '/work', 'approvalPolicy': 'never',
            'sandbox': 'read-only', 'ephemeral': True, 'environments': [],
            'dynamicTools': [], 'selectedCapabilityRoots': [], 'runtimeWorkspaceRoots': [],
            'baseInstructions': request['system']})
        require(started.get('model') == settings.MODEL and started.get('modelProvider') == 'knowledge_codex'
                and not started.get('instructionSources') and started.get('approvalPolicy') == 'never', 'CODEX_CONTEXT_MISMATCH')
        thread = started['thread']['id']
        result = rpc.call('turn/start', {'threadId': thread, 'environments': [], 'runtimeWorkspaceRoots': [],
            'input': [{'type': 'text', 'text': json.dumps(request['data'], ensure_ascii=False), 'text_elements': []}],
            'approvalPolicy': 'never', 'model': settings.MODEL, 'effort': 'medium',
            'outputSchema': output_schema(request['stage'].startswith('part:'))})
        turn = result['turn']['id']
        outputs = {}
        while True:
            event = rpc.event()
            method, params = event.get('method'), event.get('params', {})
            if method in ('error', 'thread/error'):
                raise ValueError('CODEX_GENERATION_FAILED')
            if method in ('item/started', 'item/completed', 'turn/completed'):
                require(params.get('threadId') == thread, 'CODEX_FOREIGN_THREAD')
                if method != 'turn/completed':
                    require(params.get('turnId') == turn, 'CODEX_FOREIGN_TURN')
                    item = params['item']
                    require(item['type'] in ('userMessage', 'agentMessage', 'reasoning'), 'CODEX_UNEXPECTED_TOOL')
                    if method == 'item/completed' and item['type'] == 'agentMessage':
                        require(not item.get('questions') and not item.get('memoryCitation'), 'CODEX_UNEXPECTED_CONTEXT')
                        if item.get('phase') in (None, 'final_answer'):
                            outputs[item['id']] = item['text']
                        require(sum(len(t.encode()) for t in outputs.values()) <= request['maxOutputBytes'], 'CODEX_OUTPUT_TOO_LARGE')
                else:
                    require(params['turn']['id'] == turn and params['turn']['status'] == 'completed', 'CODEX_TURN_FAILED')
                    break
        require(len(outputs) == 1, 'CODEX_SINGLE_RESULT_REQUIRED')
        value = json.loads(next(iter(outputs.values())))
        require(isinstance(value, dict) and set(value) == {'claims'}, 'CODEX_INVALID_RESULT')
        return value
    finally:
        rpc.close()


def sandbox_command(binary_fd, catalog_fd):
    # A fresh filesystem, not a bind of host /. No employee files, auth home,
    # source mount, daemon sockets, host /proc or inherited environment.
    command = ['/usr/bin/bwrap', '--die-with-parent', '--new-session', '--unshare-pid',
        '--unshare-ipc', '--unshare-uts', '--unshare-user', '--uid', '65534', '--gid', '65534',
        '--cap-drop', 'ALL', '--clearenv', '--ro-bind', '/usr', '/usr']
    for path in ('/lib', '/lib64'):
        if Path(path).exists():
            command += ['--ro-bind', path, path]
    for path in ('/etc/ssl/certs', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf'):
        if Path(path).exists():
            command += ['--ro-bind', path, path]
    command += ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run',
        '--dir', '/run/home', '--dir', '/work',
        '--perms', '0555', '--ro-bind-data', str(binary_fd), '/run/codex',
        '--perms', '0444', '--ro-bind-data', str(catalog_fd), '/run/models.json', '--chdir', '/work',
        '--setenv', 'HOME', '/run/home', '--setenv', 'CODEX_HOME', '/run/home',
        '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'TMPDIR', '/tmp',
        '/run/codex', 'app-server', *settings.arguments('/run/models.json')]
    return command


class CodexAdapter:
    model_key = settings.MODEL_KEY

    def __init__(self, binary, token_supplier):
        self.binary, self.token_supplier = Path(binary), token_supplier

    def generate(self, request, request_key, timeout_seconds):
        process = None
        try:
            require(sys.platform == 'linux' and os.geteuid() == 0, 'CODEX_HOST_SANDBOX_REQUIRED')
            require(isinstance(request_key, str) and re.fullmatch('[a-f0-9]{64}', request_key), 'CODEX_REQUEST_KEY_INVALID')
            require(0 < timeout_seconds <= 90 and request['maxOutputBytes'] == 65536
                    and len(json.dumps(request).encode()) <= 256 * 1024, 'CODEX_REQUEST_LIMIT')
            require(self.binary.is_absolute() and self.binary == self.binary.resolve(), 'CODEX_BINARY_UNSAFE')
            with os.fdopen(open_absolute(self.binary, trusted_binary=True), 'rb') as executable:
                info = os.fstat(executable.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'CODEX_BINARY_UNSAFE')
            deadline = time.monotonic() + timeout_seconds
            # Version output is local; this does not contact a provider.
            version = subprocess.run([str(self.binary), '--version'], capture_output=True, timeout=5,
                                     env={'PATH': '/usr/bin:/bin'}).stdout.decode().strip()
            require(version == settings.VERSION, 'CODEX_VERSION_MISMATCH')
            login = self.token_supplier()
            with tempfile.TemporaryDirectory(prefix='aibrain-knowledge-') as temporary:
                catalog_path = Path(temporary) / 'models.json'
                catalog_path.write_text(json.dumps(settings.catalog()))
                # bwrap drops mount-time filesystem privileges when selecting the
                # child UID. Pass already-open public inputs, so private host
                # parent directories never need broader permissions.
                with os.fdopen(open_absolute(self.binary, trusted_binary=True), 'rb') as binary, catalog_path.open('rb') as catalog:
                    descriptors = (binary.fileno(), catalog.fileno())
                    process = subprocess.Popen(sandbox_command(*descriptors), stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={'PATH': '/usr/bin:/bin'},
                        start_new_session=True, pass_fds=descriptors)
                    return exchange(process, request, login, deadline)
        except Exception:
            # No claim that a failed/expired turn was undispatched. The durable
            # worker blocks an uncertain outcome and never silently retries it.
            raise ValueError('CODEX_GENERATION_UNAVAILABLE') from None
        finally:
            if process:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=5)
                process.stdin.close()
                process.stdout.close()
