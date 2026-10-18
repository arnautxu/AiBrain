#!/usr/bin/env python3
"""Check tracked source and history against an operator-managed boundary policy.

The policy contains salted digests, never environment names or credentials.
Only paths and object IDs are reported on failure, never matching source text.
"""
import hashlib
import functools
import json
import os
import re
import subprocess
import sys
import tempfile


def candidates(text):
    for raw in re.findall(r"[A-Za-z0-9]+", text):
        # Include prefixes so installation suffixes and camelCase identifiers
        # cannot hide a blocked environment name.
        parts = [raw, *re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", raw).split()]
        for part in parts:
            word = part.casefold()
            for size in range(3, min(len(word), 48) + 1):
                yield word[:size]


def main():
    try:
        policy = json.loads(os.environ["SOURCE_BOUNDARY_POLICY"])
        salt = policy["salt"]
        denied = set(policy["digests"])
        if not isinstance(salt, str) or len(salt) < 32 or not denied or any(
            not isinstance(d, str) or not re.fullmatch(r"[a-f0-9]{64}", d) for d in denied
        ):
            raise ValueError()
    except (KeyError, ValueError, TypeError):
        sys.exit("Source boundary policy is missing or invalid; publication is blocked.")

    @functools.lru_cache(maxsize=131072)
    def denied_word(word):
        return hashlib.sha256((salt + "\0" + word).encode()).hexdigest() in denied

    def blocked(data):
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            return False
        if "\0" in text:
            return False
        return any(denied_word(word) for word in candidates(text))

    paths = subprocess.check_output(["git", "ls-files", "-z"]).split(b"\0")
    failures = []
    for path in filter(None, paths):
        if blocked(path) or blocked(open(os.fsdecode(path), "rb").read()):
            failures.append(os.fsdecode(path))
    # Full history is available in the publication job. This also rejects a
    # merge which would reintroduce an obsolete history through a second parent.
    history = subprocess.check_output(["git", "log", "--all", "--format=%H%x00%B%x00"])
    if blocked(history):
        failures.append("commit metadata")
    objects = subprocess.check_output(["git", "rev-list", "--objects", "--all"]).splitlines()
    with tempfile.TemporaryFile() as identifiers:
        for entry in objects:
            oid, _, name = entry.partition(b" ")
            if name and blocked(name):
                failures.append("historical path " + oid.decode())
            identifiers.write(oid + b"\n")
        identifiers.seek(0)
        process = subprocess.Popen(["git", "cat-file", "--batch"], stdin=identifiers, stdout=subprocess.PIPE)
        for _ in objects:
            oid, kind, size = process.stdout.readline().split()
            data = process.stdout.read(int(size))
            if process.stdout.read(1) != b"\n":
                raise RuntimeError("Invalid source object stream")
            if kind == b"blob" and blocked(data):
                failures.append("historical object " + oid.decode())
        if process.wait():
            raise RuntimeError("Source object scan failed")
    if failures:
        print("Source boundary violation in:", *failures, sep="\n", file=sys.stderr)
        return 1
    print("Source boundary: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
