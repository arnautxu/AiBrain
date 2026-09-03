#!/usr/bin/env python3
"""Bounded on-demand metadata traversal, sharing the background job's cursors."""
import fcntl
from contextlib import contextmanager
import importlib.util
import os
from pathlib import Path
import time


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


inventory = module('folder_inventory_worker', 'knowledge-inventory.py')
mapping = module('folder_inventory_map', 'knowledge-map.py')
files = inventory.files


def next_directory(store, scan, source):
    key = inventory.catalogue.source_key(source)
    row = store.db.execute("SELECT * FROM directories WHERE scan=? AND state='pending' AND "
                           "(source_key=? OR instr(source_key,?)=1) ORDER BY length(source_key),offset,rowid LIMIT 1",
                           (scan, key, key.rstrip('\\') + '\\')).fetchone()
    return dict(row) if row else None


def fill(store, manifest, scan, source, run):
    # Two durable pages per call. Further calls resume; no retry counters reset.
    pages = 0
    started = time.monotonic()
    for _ in range(2):
        if pages and time.monotonic() - started >= 10:
            break
        row = next_directory(store, scan, source)
        if row is None:
            break
        try:
            inventory.process_page(store, manifest, scan, row, run=run)
            pages += 1
        except BlockingIOError:
            return {'pagesRead': pages, 'state': 'SOURCE_BUSY'}
        except Exception as error:
            code = inventory.source_failure(error)
            store.directory_failed(scan, row['source'], code)
            return {'pagesRead': pages, 'state': code}
    return {'pagesRead': pages, 'state': 'CONTINUE' if next_directory(store, scan, source) else 'FINISHED'}


@contextmanager
def interactive_access(manifest):
    target = mapping.map_root(manifest)
    operator = target.parent / 'operator'
    # Installations without a metadata worker retain the existing source route.
    if not (operator / 'inventory.lock').exists():
        yield operator
        return
    # The background worker yields after its current page, never by interrupting
    # Windows or the app. Expiry also handles a killed broker child safely.
    mapping.atomic_text(operator / 'interactive-until', str(time.time() + 200))
    fd = None
    try:
        lock = operator / 'inventory.lock'
        mapping.private(lock)
        fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
        deadline = time.monotonic() + 55
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise BlockingIOError('CATALOGUE_BUSY')
                time.sleep(0.5)
        yield operator
    finally:
        if fd is not None:
            os.close(fd)
        mapping.atomic_text(operator / 'interactive-until', '0')


def execute(manifest, path, offset=0):
    result = mapping.folder_inventory(manifest, path, offset, files)
    if result is None:
        return {'available': False, 'error': 'FOLDER_NOT_MAPPED',
                'warning': 'Localiza primero la carpeta con search, navegando desde su padre observado. No inventes una carpeta a partir del año solicitado.'}
    if result['enumerationComplete'] or not result['directories'].get('pending'):
        return result
    target = mapping.map_root(manifest)
    source, _ = files.source_path(manifest['connectionId'], path)
    binding, _ = mapping.policy(manifest, files)
    store = None
    try:
        with interactive_access(manifest) as operator:
            store = inventory.catalogue.Catalogue(operator, manifest['installationId'], 'operator', manifest['maxFileBytes'])
            scan = store.db.execute('SELECT * FROM scans ORDER BY rowid DESC LIMIT 1').fetchone()
            if not scan or scan['state'] != 'running':
                result['discovery'] = {'pagesRead': 0, 'state': 'SCAN_NOT_RUNNING'}
                return result
            with inventory.listings.ListingSession(manifest) as listing:
                discovery = fill(store, manifest, scan['id'], source, listing)
            current_binding, allowed = mapping.policy(manifest, files)
            mapping.require(current_binding == binding, 'MAP_POLICY_CHANGED')
            mapping.build(operator, target, manifest, binding, allowed)
            result = mapping.folder_inventory(manifest, path, offset, files)
            mapping.require(result is not None, 'MAP_POLICY_CHANGED')
            result['discovery'] = discovery
            return result
    except BlockingIOError:
        result['discovery'] = {'pagesRead': 0, 'state': 'CATALOGUE_BUSY'}
        return result
    finally:
        if store:
            store.close()
