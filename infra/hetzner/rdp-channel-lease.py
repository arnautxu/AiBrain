"""Durable fail-closed exclusion for an optional live read channel.

A crash never authorizes a second RDP execution: only a confirmed signed stop
can remove this marker. Legacy callers check it before opening their session.
"""
import json
import os
from pathlib import Path
import re
import stat


def read(root):
    path = Path(root) / '.read-channel-lease.json'
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError('SERVER_CHANNEL_QUARANTINED')
    with path.open() as file:
        value = json.load(file)
    if not isinstance(value, dict) or set(value) != {'job', 'nonce'} or not re.fullmatch(r'channel-[a-f0-9]{32}', value.get('job', '')) or not re.fullmatch(r'[a-f0-9]{32}', value.get('nonce', '')):
        raise ValueError('SERVER_CHANNEL_QUARANTINED')
    return value


def check(destination):
    destination = Path(destination)
    value = read(destination.parent)
    if value is not None and value['job'] != destination.name:
        raise ValueError('SERVER_CHANNEL_QUARANTINED')


def acquire(root, job, nonce):
    path = Path(root) / '.read-channel-lease.json'
    with path.open('x', opener=lambda p, flags: os.open(p, flags, 0o600)) as file:
        json.dump({'job': job, 'nonce': nonce}, file)
        file.flush()
        os.fsync(file.fileno())
    fd = os.open(root, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def release(root, job, nonce):
    if read(root) != {'job': job, 'nonce': nonce}:
        raise ValueError('SERVER_CHANNEL_QUARANTINED')
    (Path(root) / '.read-channel-lease.json').unlink()
    fd = os.open(root, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
