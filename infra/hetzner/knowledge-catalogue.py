#!/usr/bin/env python3
"""Private, scope-partitioned catalogue. No network or provider calls.

Callers are trusted host services, not employees. They resolve an authorized
partition before opening this store. Sources and citations are untrusted data.
"""
import datetime as dt
from contextlib import contextmanager
import hashlib
import json
import ntpath
import os
from pathlib import Path
import re
import sqlite3
import stat
import uuid
import urllib.parse

FORMATS = {".pdf", ".docx", ".xlsx", ".xls", ".doc", ".rtf", ".txt", ".csv", ".md", ".json", ".png", ".jpg", ".jpeg", ".bmp"}
ID = re.compile(r"[a-z0-9][a-z0-9-]{0,62}")
SECRET = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*|\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*[\"']?[A-Za-z0-9._~+/-]{16,}", re.I)


def require(ok, code):
    if not ok:
        raise ValueError(code)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def source_key(source):
    require(isinstance(source, str) and len(source) <= 1024 and
            re.match(r"^[A-Za-z]:\\", source) and
            not any(ord(c) < 32 for c in source), "INVALID_SOURCE")
    parts = source[3:].split("\\") if len(source) > 3 else []
    require(all(p and p not in {".", ".."} and not re.search(r'[/:*?<>|\"]', p)
                and not p.endswith((".", " ")) for p in parts), "INVALID_SOURCE")
    return ntpath.normcase(source)


def fingerprint(size, modified):
    return hashlib.sha256(json.dumps([size, modified]).encode()).hexdigest()


class Catalogue:
    """One installation and one audience per private directory/database."""

    def __init__(self, directory, installation, audience, max_file_bytes=16*1024*1024, readonly=False):
        require(isinstance(installation, str) and ID.fullmatch(installation), "INVALID_INSTALLATION")
        require(isinstance(audience, str) and (audience in {"operator", "company"} or
                re.fullmatch(r"(?:department|project|private):[0-9a-f-]{36}", audience)), "INVALID_AUDIENCE")
        require(type(max_file_bytes) is int and 0 < max_file_bytes <= 16*1024*1024, "INVALID_BYTE_LIMIT")
        directory = Path(directory)
        require(directory.is_absolute(), "ABSOLUTE_DIRECTORY_REQUIRED")
        # Check every existing ancestor before mkdir: never follow a symlink.
        for p in [*reversed(directory.parents), directory]:
            if p.exists() or p.is_symlink():
                require(not p.is_symlink() and p.is_dir(), "UNSAFE_STORE_PATH")
        if readonly:
            require(directory.is_dir(),"PARTITION_UNAVAILABLE")
        else:
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = directory.stat()
        require(info.st_uid == os.geteuid() and not info.st_mode & 0o077, "PRIVATE_STORE_REQUIRED")
        database = directory / "catalogue.sqlite3"
        for name in ("catalogue.sqlite3", "catalogue.sqlite3-wal", "catalogue.sqlite3-shm", "catalogue.sqlite3-journal"):
            candidate = directory / name
            if candidate.exists() or candidate.is_symlink():
                info = candidate.lstat()
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                        info.st_uid == os.geteuid() and not info.st_mode & 0o077, "UNSAFE_DATABASE")
        fd = os.open(database, (os.O_RDONLY if readonly else os.O_CREAT | os.O_RDWR) | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        self.db = sqlite3.connect("file:"+urllib.parse.quote(str(database))+"?mode="+("ro" if readonly else "rw"),uri=True,timeout=5)
        self.db.row_factory = sqlite3.Row
        self.max_file_bytes = max_file_bytes
        if readonly:
            self.db.execute("PRAGMA query_only=ON")
            identity = self.db.execute("SELECT * FROM identity").fetchone()
            if not identity or (identity["installation"],identity["audience"],identity["version"]) != (installation,audience,1):
                self.db.close()
                raise ValueError("PARTITION_IDENTITY_MISMATCH")
            return
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1), installation TEXT, audience TEXT, version INTEGER);
        """)
        identity = self.db.execute("SELECT * FROM identity").fetchone()
        if identity and (identity["installation"], identity["audience"], identity["version"]) != (installation, audience, 1):
            self.db.close()
            raise ValueError("PARTITION_IDENTITY_MISMATCH")
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO identity VALUES(1,?,?,1)", (installation, audience))
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, started TEXT NOT NULL, finished TEXT, state TEXT NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS one_running_scan ON scans(state) WHERE state='running';
          CREATE TABLE IF NOT EXISTS directories (
            scan TEXT REFERENCES scans(id), source_key TEXT, source TEXT NOT NULL,
            offset INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0, reason TEXT,
            PRIMARY KEY(scan,source_key));
          CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY, source_key TEXT UNIQUE NOT NULL, source TEXT NOT NULL,
            name TEXT NOT NULL, suffix TEXT NOT NULL, bytes INTEGER NOT NULL, modified TEXT NOT NULL,
            fingerprint TEXT NOT NULL, seen_scan TEXT NOT NULL, last_seen TEXT NOT NULL,
            state TEXT NOT NULL, reason TEXT, sha256 TEXT, indexed_at TEXT);
          CREATE TABLE IF NOT EXISTS observations (
            scan TEXT, directory TEXT, source_key TEXT, fingerprint TEXT NOT NULL,
            PRIMARY KEY(scan,directory,source_key));
          CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY, document INTEGER REFERENCES documents(id), ordinal INTEGER,
            locator TEXT NOT NULL, content TEXT NOT NULL, UNIQUE(document,ordinal));
          CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(name,content,document UNINDEXED,chunk UNINDEXED,tokenize='unicode61 remove_diacritics 2');
          CREATE TABLE IF NOT EXISTS versions (
            document INTEGER REFERENCES documents(id), sha256 TEXT, observed TEXT,
            fingerprint TEXT, PRIMARY KEY(document,sha256,fingerprint));
          CREATE TABLE IF NOT EXISTS document_payloads (
            document INTEGER PRIMARY KEY REFERENCES documents(id), sha256 TEXT NOT NULL,
            payload TEXT NOT NULL, payload_hash TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS source_checks (
            document INTEGER PRIMARY KEY REFERENCES documents(id),checked_at TEXT NOT NULL,
            verified_at TEXT,outcome TEXT NOT NULL,sha256 TEXT);
          CREATE TABLE IF NOT EXISTS summary_jobs (
            id TEXT PRIMARY KEY,document INTEGER NOT NULL REFERENCES documents(id),
            sha256 TEXT NOT NULL,plan TEXT NOT NULL,drafts TEXT NOT NULL,
            record TEXT,created_at TEXT NOT NULL,synthesis TEXT,coverage TEXT);
          CREATE TABLE IF NOT EXISTS summary_execution (
            job TEXT PRIMARY KEY REFERENCES summary_jobs(id), model_key TEXT NOT NULL,
            state TEXT NOT NULL, step TEXT, attempts INTEGER NOT NULL DEFAULT 0,
            lease TEXT, lease_until REAL, next_attempt REAL NOT NULL DEFAULT 0,
            error TEXT, updated TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS knowledge_records (
            id TEXT PRIMARY KEY,kind TEXT NOT NULL,entity_type TEXT NOT NULL,entity_key TEXT NOT NULL,
            label TEXT NOT NULL,topic TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,
            revision INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,
            idempotency_key TEXT UNIQUE NOT NULL,input_hash TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS knowledge_dependencies (
            record TEXT REFERENCES knowledge_records(id),document INTEGER REFERENCES documents(id),
            sha256 TEXT NOT NULL,locator TEXT NOT NULL,quote TEXT NOT NULL,
            PRIMARY KEY(record,document,locator,quote));
          CREATE TABLE IF NOT EXISTS knowledge_corrections (
            record TEXT PRIMARY KEY REFERENCES knowledge_records(id),
            previous TEXT NOT NULL UNIQUE REFERENCES knowledge_records(id), previous_revision INTEGER NOT NULL,
            reason TEXT NOT NULL, actor TEXT NOT NULL, recorded TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS knowledge_events (
            id INTEGER PRIMARY KEY,record TEXT NOT NULL,revision INTEGER NOT NULL,
            action TEXT NOT NULL,actor TEXT NOT NULL,recorded TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS issues (
            id INTEGER PRIMARY KEY, recorded TEXT, scan TEXT, source_key TEXT, code TEXT NOT NULL);
        """)
        self.max_file_bytes = max_file_bytes

    def close(self):
        self.db.close()

    @contextmanager
    def write(self):
        # Nested domain operations must share their caller's durable transaction.
        # An inner failure rolls back only its savepoint; no inner commit may
        # publish a summary before its queue/checkpoint transaction succeeds.
        if self.db.in_transaction:
            savepoint='nested_'+uuid.uuid4().hex
            self.db.execute('SAVEPOINT '+savepoint)
            try:
                yield
                self.db.execute('RELEASE SAVEPOINT '+savepoint)
            except BaseException:
                self.db.execute('ROLLBACK TO SAVEPOINT '+savepoint)
                self.db.execute('RELEASE SAVEPOINT '+savepoint)
                raise
            return
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def start_scan(self, roots):
        require(isinstance(roots, list) and 0 < len(roots) <= 26, "INVALID_ROOTS")
        keys = [source_key(root) for root in roots]
        require(len(set(keys)) == len(keys), "DUPLICATE_ROOTS")
        require(not any(a != b and b.startswith(a.rstrip("\\") + "\\") for a in keys for b in keys), "OVERLAPPING_ROOTS")
        running = self.db.execute("SELECT id FROM scans WHERE state='running'").fetchone()
        require(running is None, "SCAN_ALREADY_RUNNING")
        scan = str(uuid.uuid4())
        with self.write():
            self.db.execute("INSERT INTO scans VALUES(?,?,NULL,'running')", (scan, now()))
            self.db.executemany("INSERT INTO directories(scan,source_key,source) VALUES(?,?,?)",
                                [(scan, key, root) for key, root in zip(keys, roots)])
        return scan

    def next_directory(self, scan, priority_roots=None, deferred_keys=None, spread_pages=False):
        require(priority_roots is None or isinstance(priority_roots,list) and len(priority_roots)<=32,"INVALID_PRIORITY_ROOTS")
        require(deferred_keys is None or isinstance(deferred_keys,set) and len(deferred_keys)<=1000,"INVALID_DEFERRED_DIRECTORIES")
        priorities=[source_key(root).rstrip("\\") for root in priority_roots or []]
        clauses=["(source_key=? OR instr(source_key,?||'\\')=1 OR instr(?,rtrim(source_key,'\\')||'\\')=1)" for _ in priorities]
        order="CASE WHEN "+" OR ".join(clauses)+" THEN 0 ELSE 1 END," if clauses else ""
        require(type(spread_pages) is bool,"INVALID_PAGE_ORDER")
        if spread_pages:
            # Discover unvisited folders before draining another large folder.
            # Offset is durable, so this ordering survives service restarts.
            order="offset,"+order
        values=[scan]+[value for priority in priorities for value in [priority]*3]
        # LIMIT stays bounded and avoids a growing SQL parameter list. At most
        # len(deferred_keys) leading rows can be excluded from this batch.
        rows = self.db.execute("SELECT * FROM directories WHERE scan=? AND state='pending' ORDER BY "+order+"rowid LIMIT ?",values+[len(deferred_keys or [])+1]).fetchall()
        return next((dict(row) for row in rows if row["source_key"] not in (deferred_keys or set())),None)

    def record_page(self, scan, directory, offset, entries, next_offset, limited=False, transport_count=None):
        """Entries and cursor commit together. Replaying an old page is rejected."""
        key = source_key(directory)
        require(type(offset) is int and offset >= 0 and isinstance(entries, list) and len(entries) <= 50, "INVALID_PAGE")
        require(type(limited) is bool, "INVALID_COVERAGE")
        count = len(entries) if transport_count is None else transport_count
        require(type(count) is int and len(entries) <= count <= 50 and (count == len(entries) or limited), "INVALID_TRANSPORT_COUNT")
        require(next_offset is None or (type(next_offset) is int and next_offset == offset + count and count > 0), "INVALID_CURSOR")
        row = self.db.execute("SELECT * FROM directories WHERE scan=? AND source_key=?", (scan, key)).fetchone()
        require(row and row["state"] == "pending" and row["offset"] == offset, "STALE_DIRECTORY_PAGE")
        validated, seen = [], set()
        for item in entries:
            candidate = source_key(item["source"])
            require(ntpath.dirname(candidate).rstrip("\\") == key.rstrip("\\") and candidate not in seen, "INVALID_PAGE_PARENT_OR_DUPLICATE")
            seen.add(candidate)
            require(type(item["directory"]) is bool and type(item["bytes"]) is int and item["bytes"] >= 0, "INVALID_ENTRY")
            require(isinstance(item["modifiedUtc"], str) and len(item["modifiedUtc"]) <= 64, "INVALID_MODIFIED_TIME")
            dt.datetime.fromisoformat(item["modifiedUtc"].replace("Z", "+00:00"))
            validated.append((candidate, item))
        with self.write():
            current = self.db.execute("SELECT offset,state FROM directories WHERE scan=? AND source_key=?", (scan,key)).fetchone()
            require(current and current["offset"] == offset and current["state"] == "pending", "STALE_DIRECTORY_PAGE")
            for candidate, item in validated:
                version = fingerprint(item["bytes"], item["modifiedUtc"])
                # Duplicate observations across pages indicate a changing listing.
                old = self.db.execute("SELECT fingerprint FROM observations WHERE scan=? AND directory=? AND source_key=?", (scan, key, candidate)).fetchone()
                if old:
                    limited = True
                self.db.execute("INSERT OR REPLACE INTO observations VALUES(?,?,?,?)", (scan, key, candidate, version))
                if item["directory"]:
                    self.db.execute("INSERT OR IGNORE INTO directories(scan,source_key,source) VALUES(?,?,?)", (scan, candidate, item["source"]))
                    continue
                suffix = ntpath.splitext(candidate)[1]
                state = "pending" if suffix in FORMATS and item["bytes"] <= self.max_file_bytes else "unsupported"
                reason = None if state == "pending" else "FORMAT_OR_SIZE_UNSUPPORTED"
                previous = self.db.execute("SELECT * FROM documents WHERE source_key=?", (candidate,)).fetchone()
                if previous and previous["fingerprint"] != version:
                    self._remove_content(previous["id"])
                self.db.execute("""INSERT INTO documents(source_key,source,name,suffix,bytes,modified,fingerprint,seen_scan,last_seen,state,reason)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET
                    source=excluded.source,name=excluded.name,bytes=excluded.bytes,modified=excluded.modified,
                    seen_scan=excluded.seen_scan,last_seen=excluded.last_seen,
                    state=CASE WHEN documents.state='withdrawn' AND documents.reason IN ('ACCESS_REVOKED','SCOPE_CHANGED') THEN 'withdrawn' WHEN documents.fingerprint=excluded.fingerprint AND documents.state IN ('indexed','pending','unreadable','unsupported') THEN documents.state ELSE excluded.state END,
                    reason=CASE WHEN documents.state='withdrawn' AND documents.reason IN ('ACCESS_REVOKED','SCOPE_CHANGED') THEN documents.reason WHEN documents.fingerprint=excluded.fingerprint THEN documents.reason ELSE excluded.reason END,
                    sha256=CASE WHEN documents.fingerprint=excluded.fingerprint THEN documents.sha256 ELSE NULL END,
                    indexed_at=CASE WHEN documents.fingerprint=excluded.fingerprint THEN documents.indexed_at ELSE NULL END,
                    fingerprint=excluded.fingerprint""",
                    (candidate,item["source"],ntpath.basename(item["source"]),suffix,item["bytes"],item["modifiedUtc"],version,scan,now(),state,reason))
            reason = "UNSTABLE_OR_FILTERED_LISTING" if limited or row["reason"] == "UNSTABLE_OR_FILTERED_LISTING" else None
            state = "pending" if next_offset is not None else "incomplete" if reason else "complete"
            self.db.execute("UPDATE directories SET offset=?,state=?,reason=? WHERE scan=? AND source_key=?", (next_offset if next_offset is not None else offset+count,state,reason,scan,key))

    def directory_failed(self, scan, source, code="SOURCE_UNAVAILABLE", retry_limit=3):
        require(code in {"SOURCE_UNAVAILABLE", "SOURCE_ACCESS_DENIED", "INVALID_SOURCE_PAGE", "SOURCE_POLICY_DENIED",
                        "SOURCE_PATH_UNAVAILABLE", "SOURCE_COMMAND_TOO_LARGE", "SOURCE_CONNECTION_LOST",
                        "SOURCE_READBACK_UNCONFIRMED", "SOURCE_CONNECTION_FAILED", "SOURCE_TIMEOUT",
                        "SOURCE_PROCESS_FAILED"}, "INVALID_FAILURE_CODE")
        require(type(retry_limit) is int and 1 <= retry_limit <= 10, "INVALID_RETRY_LIMIT")
        key = source_key(source)
        with self.write():
            row = self.db.execute("SELECT * FROM directories WHERE scan=? AND source_key=?", (scan,key)).fetchone()
            require(row and row["state"] == "pending", "DIRECTORY_NOT_PENDING")
            attempts = row["attempts"] + 1
            self.db.execute("UPDATE directories SET attempts=?,state=?,reason=? WHERE scan=? AND source_key=?",
                            (attempts,"incomplete" if attempts >= retry_limit else "pending",code,scan,key))
            self.db.execute("INSERT INTO issues(recorded,scan,source_key,code) VALUES(?,?,?,?)", (now(),scan,key,code))

    def finish_scan(self, scan):
        require(self.next_directory(scan) is None, "SCAN_HAS_PENDING_DIRECTORIES")
        with self.write():
            require(self.db.execute("SELECT 1 FROM scans WHERE id=? AND state='running'", (scan,)).fetchone(), "SCAN_NOT_RUNNING")
            incomplete = self.db.execute("SELECT count(*) FROM directories WHERE scan=? AND state='incomplete'", (scan,)).fetchone()[0]
            self.db.execute("UPDATE scans SET state=?,finished=? WHERE id=?", ("incomplete" if incomplete else "observed",now(),scan))
        # Intentionally no deletion: pagination does not provide a frozen snapshot.
        return self.coverage(scan)

    def _remove_content(self, document):
        self.db.execute("DELETE FROM source_checks WHERE document=?",(document,))
        self.db.execute("INSERT INTO knowledge_events(record,revision,action,actor,recorded) SELECT id,revision+1,'source-invalidated','source-sync',? FROM knowledge_records WHERE id IN (SELECT record FROM knowledge_dependencies WHERE document=?) AND status IN ('proposed','confirmed')",(now(),document))
        self.db.execute("UPDATE knowledge_records SET status='stale',revision=revision+1,updated=? WHERE id IN (SELECT record FROM knowledge_dependencies WHERE document=?) AND status IN ('proposed','confirmed')",(now(),document))
        self.db.execute("DELETE FROM document_payloads WHERE document=?",(document,))
        self.db.execute("DELETE FROM search_index WHERE document=?", (document,))
        self.db.execute("DELETE FROM chunks WHERE document=?", (document,))

    def index_document(self, source, expected_fingerprint, sha256, chunks, structured=None):
        require(isinstance(sha256, str) and re.fullmatch(r"[a-f0-9]{64}",sha256), "INVALID_HASH")
        require(isinstance(chunks,list) and 0 < len(chunks) <= 2000, "INVALID_CHUNKS")
        total = 0
        payload=None
        if structured is not None:
            require(isinstance(structured,dict) and structured.get("ok") is True and
                    isinstance(structured.get("segments"),list) and isinstance(structured.get("tables"),list),"INVALID_STRUCTURED_CONTENT")
            payload=json.dumps(structured,ensure_ascii=False,sort_keys=True,separators=(",",":"))
            require(len(payload.encode())<=8*1024*1024 and not SECRET.search(payload),"STRUCTURED_CONTENT_REJECTED")
        for chunk in chunks:
            require(set(chunk) == {"locator","content"} and isinstance(chunk["locator"],str) and
                    0 < len(chunk["locator"]) <= 500 and isinstance(chunk["content"],str) and chunk["content"].strip(), "INVALID_CHUNK")
            require(not SECRET.search(chunk["content"]) and not SECRET.search(chunk["locator"]), "CREDENTIAL_SHAPED_CONTENT")
            total += len(chunk["content"].encode())
            require(total <= 2*1024*1024 and len(chunk["content"].encode()) <= 120*1024, "CONTENT_LIMIT")
        with self.write():
            row = self.db.execute("SELECT * FROM documents WHERE source_key=?", (source_key(source),)).fetchone()
            require(row and row["fingerprint"] == expected_fingerprint and row["state"] in {"pending","indexed","unreadable"}, "SOURCE_VERSION_CHANGED")
            prior_payload=self.db.execute("SELECT payload_hash FROM document_payloads WHERE document=?",(row["id"],)).fetchone()
            prior_chunks=[dict(chunk) for chunk in self.db.execute("SELECT locator,content FROM chunks WHERE document=? ORDER BY ordinal",(row["id"],))]
            if row["state"]=='indexed' and row["sha256"]==sha256 and prior_chunks==chunks and (prior_payload[0] if prior_payload else None)==(hashlib.sha256(payload.encode()).hexdigest() if payload is not None else None):
                return
            self._remove_content(row["id"])
            if payload is not None:
                self.db.execute("INSERT INTO document_payloads VALUES(?,?,?,?)",(row["id"],sha256,payload,hashlib.sha256(payload.encode()).hexdigest()))
            for ordinal, chunk in enumerate(chunks):
                cursor = self.db.execute("INSERT INTO chunks(document,ordinal,locator,content) VALUES(?,?,?,?)", (row["id"],ordinal,chunk["locator"],chunk["content"]))
                self.db.execute("INSERT INTO search_index(name,content,document,chunk) VALUES(?,?,?,?)", (row["name"],chunk["content"],row["id"],cursor.lastrowid))
            self.db.execute("INSERT OR IGNORE INTO versions VALUES(?,?,?,?)", (row["id"],sha256,now(),expected_fingerprint))
            self.db.execute("UPDATE documents SET state='indexed',reason=NULL,sha256=?,indexed_at=? WHERE id=?", (sha256,now(),row["id"]))

    def withdraw(self, source, reason):
        require(reason in {"SOURCE_DELETED", "ACCESS_REVOKED", "SCOPE_CHANGED"}, "INVALID_WITHDRAWAL")
        with self.write():
            row = self.db.execute("SELECT id FROM documents WHERE source_key=?", (source_key(source),)).fetchone()
            if row:
                self._remove_content(row["id"])
                self.db.execute("UPDATE documents SET state='withdrawn',reason=?,sha256=NULL,indexed_at=NULL WHERE id=?", (reason,row["id"]))

    def source_current(self,source,sha256,max_age=86400,at=None):
        document=self.document(source)
        if not document or document['state']!='indexed' or document['sha256']!=sha256:
            return False
        check=self.db.execute('SELECT * FROM source_checks WHERE document=?',(document['id'],)).fetchone()
        verified=check['verified_at'] if check else document['indexed_at']
        if not verified or check and check['sha256']!=sha256:
            return False
        stamp=dt.datetime.fromisoformat(verified.replace('Z','+00:00'))
        if stamp.tzinfo is None:
            return False
        age=((at or dt.datetime.now(dt.timezone.utc))-stamp).total_seconds()
        return 0<=age<=max_age

    def record_source_check(self,expected,result):
        require(isinstance(result,dict) and source_key(result.get('source'))==expected['source_key']
                and result.get('state') in {'present','missing','denied','unavailable','oversized'},'INVALID_SOURCE_CHECK')
        outcome=result['state']
        if outcome in {'present','oversized'}:
            require(type(result.get('bytes')) is int and result['bytes']>=0 and isinstance(result.get('modifiedUtc'),str),'INVALID_SOURCE_METADATA')
            stamp=dt.datetime.fromisoformat(result['modifiedUtc'].replace('Z','+00:00'))
            require(stamp.tzinfo is not None,'INVALID_SOURCE_METADATA')
        if outcome=='present':
            require(result['bytes']<=self.max_file_bytes and isinstance(result.get('sha256'),str) and re.fullmatch(r'[a-f0-9]{64}',result['sha256']),'INVALID_SOURCE_DIGEST')
        elif outcome=='oversized':
            require(result['bytes']>self.max_file_bytes,'INVALID_SOURCE_METADATA')
        with self.write():
            row=self.db.execute('SELECT * FROM documents WHERE id=?',(expected['id'],)).fetchone()
            require(row and all(row[key]==expected[key] for key in ('fingerprint','sha256','state')),'SOURCE_VERSION_CHANGED')
            checked=now()
            old=self.db.execute('SELECT * FROM source_checks WHERE document=?',(row['id'],)).fetchone()
            verified=old['verified_at'] if old else row['indexed_at']
            digest=old['sha256'] if old else row['sha256']
            if outcome in {'missing','denied'}:
                self._remove_content(row['id'])
                reason='SOURCE_DELETED' if outcome=='missing' else 'ACCESS_REVOKED'
                self.db.execute("UPDATE documents SET state='withdrawn',reason=?,sha256=NULL,indexed_at=NULL WHERE id=?",(reason,row['id']))
                verified,digest=None,None
            elif outcome in {'present','oversized'}:
                version=fingerprint(result['bytes'],result['modifiedUtc'])
                changed=version!=row['fingerprint'] or result.get('sha256')!=row['sha256'] or row['state']=='withdrawn'
                if changed:
                    self._remove_content(row['id'])
                    state='unsupported' if outcome=='oversized' else 'pending'
                    self.db.execute('UPDATE documents SET bytes=?,modified=?,fingerprint=?,last_seen=?,state=?,reason=?,sha256=NULL,indexed_at=NULL WHERE id=?',
                        (result['bytes'],result['modifiedUtc'],version,checked,state,'FORMAT_OR_SIZE_UNSUPPORTED' if state=='unsupported' else None,row['id']))
                verified=checked if outcome=='present' else None
                digest=result.get('sha256')
            self.db.execute('INSERT OR REPLACE INTO source_checks VALUES(?,?,?,?,?)',(row['id'],checked,verified,outcome,digest))
            if outcome=='unavailable':
                self.db.execute('INSERT INTO issues(recorded,source_key,code) VALUES(?,?,?)',(checked,row['source_key'],'SOURCE_CHECK_UNAVAILABLE'))
        return outcome

    def search(self, query, limit=20):
        require(isinstance(query,str) and 0 < len(query.strip()) <= 200 and type(limit) is int and 1 <= limit <= 50, "INVALID_QUERY")
        terms = re.findall(r"[^\W_]+",query, re.UNICODE)
        if not terms:
            return []
        expression = " AND ".join('"' + term + '"' for term in terms)
        return [dict(row) for row in self.db.execute("""SELECT d.source,d.sha256,d.modified,d.last_seen,d.indexed_at,c.locator,
            snippet(search_index,1,'','', ' … ',32) AS excerpt,bm25(search_index) AS rank
            FROM search_index JOIN documents d ON d.id=search_index.document JOIN chunks c ON c.id=search_index.chunk
            WHERE search_index MATCH ? AND d.state='indexed' ORDER BY rank LIMIT ?""", (expression,limit))]

    def find_files(self, query, limit=50):
        require(isinstance(query,str) and 0 < len(query.strip()) <= 200 and
                type(limit) is int and 1 <= limit <= 50,"INVALID_QUERY")
        # Literal substrings: employee punctuation never becomes SQL wildcards.
        needle = query.strip().lower().replace("\\","\\\\").replace("%","\\%").replace("_","\\_")
        return [dict(row) for row in self.db.execute("""SELECT source,name,bytes,modified,last_seen,state,reason,sha256
            FROM documents WHERE source_key LIKE ? ESCAPE '\\' AND state<>'withdrawn'
            ORDER BY last_seen DESC,source_key LIMIT ?""",("%"+needle+"%",limit))]

    def document(self,source):
        row = self.db.execute("SELECT * FROM documents WHERE source_key=? AND state<>'withdrawn'",(source_key(source),)).fetchone()
        return dict(row) if row else None

    def read_document(self,source,sha256,part=1):
        require(type(part) is int and 1 <= part <= 2000,"INVALID_PART")
        row = self.document(source)
        require(row and row["state"]=='indexed' and row["sha256"]==sha256,"INDEXED_VERSION_UNAVAILABLE")
        count = self.db.execute("SELECT count(*) FROM chunks WHERE document=?",(row["id"],)).fetchone()[0]
        chunk = self.db.execute("SELECT locator,content FROM chunks WHERE document=? AND ordinal=?",(row["id"],part-1)).fetchone()
        require(chunk is not None,"PART_UNAVAILABLE")
        return {"source":row["source"],"sha256":sha256,"modified":row["modified"],"lastSeen":row["last_seen"],
                "indexedAt":row["indexed_at"],"part":part,"parts":count,**dict(chunk)}

    def structured_document(self,source,sha256):
        row=self.document(source)
        require(row and row["state"]=='indexed' and row["sha256"]==sha256,"INDEXED_VERSION_UNAVAILABLE")
        payload=self.db.execute("SELECT * FROM document_payloads WHERE document=? AND sha256=?",(row["id"],sha256)).fetchone()
        require(payload and hashlib.sha256(payload["payload"].encode()).hexdigest()==payload["payload_hash"],"STRUCTURED_CONTENT_UNAVAILABLE")
        return json.loads(payload["payload"])

    def coverage(self, scan):
        row = self.db.execute("SELECT * FROM scans WHERE id=?", (scan,)).fetchone()
        require(row is not None,"UNKNOWN_SCAN")
        counts = lambda table: {item[0]: item[1] for item in self.db.execute(
            "SELECT state,count(*) FROM " + table + (" WHERE scan=?" if table == "directories" else " WHERE seen_scan=?") + " GROUP BY state", (scan,))}
        formats = [dict(item) for item in self.db.execute("SELECT suffix,count(*) AS files,sum(bytes) AS bytes FROM documents WHERE seen_scan=? GROUP BY suffix ORDER BY bytes DESC",(scan,))]
        directory_issues = [dict(item) for item in self.db.execute(
            "SELECT state,reason,count(*) AS directories FROM directories WHERE scan=? AND reason IS NOT NULL GROUP BY state,reason ORDER BY state,reason", (scan,))]
        return {"scan": dict(row), "directories": counts("directories"), "directoryIssues":directory_issues, "documents": counts("documents"), "formats":formats,
                "unconfirmedFromPreviousScans": self.db.execute("SELECT count(*) FROM documents WHERE seen_scan<>? AND state<>'withdrawn'", (scan,)).fetchone()[0],
                "snapshot": False, "warning": "Coverage is an observation over time. Missing, inaccessible and unreadable sources are not proof of absence."}
