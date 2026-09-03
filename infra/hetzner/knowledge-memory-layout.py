#!/usr/bin/env python3
"""Add a non-overwriting guide to already provisioned private user memories."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import stat


def require(ok, code):
    if not ok:
        raise ValueError(code)


def safe(path, uid, directory=False):
    info = path.lstat()
    require(path.resolve() == path and info.st_uid == uid and not info.st_mode & 0o077 and
            (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1), 'UNSAFE_MEMORY_LAYOUT')


def seed(users, uid, gid, template):
    users = Path(users)
    require(users.resolve() == users and users.is_dir(), 'UNSAFE_USERS_ROOT')
    result = {'created': 0, 'existing': 0, 'disabled': 0}
    for root in sorted(users.iterdir()):
        if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', root.name):
            continue
        safe(root, uid, True)
        identity = root / 'user.json'
        safe(identity, uid)
        require(identity.stat().st_size <= 32 * 1024, 'USER_IDENTITY_LIMIT')
        user = json.loads(identity.read_text())
        require(user.get('userId') == root.name and type(user.get('enabled')) is bool, 'USER_IDENTITY_MISMATCH')
        if not user['enabled']:
            result['disabled'] += 1
            continue
        memory = root / 'memory'
        safe(memory, uid, True)
        safe(root / 'PROFILE.md', uid)
        safe(root / 'PREFERENCES.md', uid)
        target = memory / 'README.md'
        if target.exists() or target.is_symlink():
            safe(target, uid)
            result['existing'] += 1
            continue
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as handle:
            os.fchown(handle.fileno(), uid, gid)
            handle.write(template)
            handle.flush()
            os.fsync(handle.fileno())
        fd = os.open(memory, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        result['created'] += 1
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'HOST_OPERATOR_REQUIRED')
    spec = importlib.util.spec_from_file_location('memory_files', Path(__file__).with_name('rdp-server-files.py'))
    files = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(files)
    manifest = files.sync.load_manifest(args.manifest)
    template = Path(__file__).with_name('USER_MEMORY_README.md').read_text()
    print(json.dumps(seed(Path(manifest['dataRootHost']) / 'users', manifest['appUid'], manifest['appGid'], template)))


if __name__ == '__main__':
    main()
