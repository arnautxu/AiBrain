#!/usr/bin/env python3
"""Verified, bounded content ingestion into a private catalogue partition."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time


def module(name,filename):
    spec = importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


inventory = module("knowledge_inventory","knowledge-inventory.py")
catalogue, files = inventory.catalogue, inventory.files
require = catalogue.require
EXTRACTOR_REVISION = "located-v5"
RETRY_DELAYS = (300, 1800)  # Three total attempts per observed source version.
RETRYABLE_FAILURES = frozenset({"COPY_UNAVAILABLE", "SOURCE_CHANGED_DURING_COPY"})
# Fixed codes only: parser messages may contain document text or local paths.
EXTRACTION_FAILURES = frozenset({
    "ARCHIVE_LIMIT", "BINARY_CONTENT", "CELL_LIMIT", "CREDENTIAL_SHAPED_CONTENT",
    "EMPTY_TEXT", "EXTRACTION_OUTPUT_LIMIT", "FORMAT_OR_SIZE_REJECTED",
    "INVALID_CELL_ADDRESS", "INVALID_OCR_LANGUAGES", "INVALID_SHARED_STRING",
    "INVALID_SHEET_NAME", "INVALID_SHEET_TARGET", "JSON_ENCODING_UNSUPPORTED",
    "OCR_IMAGE_LIMIT", "OCR_PAGE_LIMIT", "PARSER_FAILED", "PARSER_PROCESS_FAILED",
    "PARSER_TIMEOUT", "PDF_PAGE_LIMIT", "SHEET_LIMIT", "TEXT_ENCODING_UNAVAILABLE",
    "TEXT_TOO_LARGE", "XML_ENTITY_REJECTED", "XML_TOO_LARGE",
    "SANDBOX_TIMEOUT", "SANDBOX_PROCESS_FAILED", "INVALID_EXTRACTION_RESULT",
    "XLS_READER_UNAVAILABLE", "XLS_INVALID_OR_ENCRYPTED", "XLS_INVALID_DATE_MODE",
    "XLS_INVALID_NUMBER", "XLS_INVALID_CELL_TYPE",
    "RTF_TABLE_STRUCTURE", "RTF_SIGNATURE_REQUIRED",
    "IMAGE_SIGNATURE_REQUIRED", "OCR_PIXEL_LIMIT",
})


class ExtractionFailure(ValueError):
    def __init__(self, reason):
        super().__init__(reason if isinstance(reason,str) and reason in EXTRACTION_FAILURES else "CONTENT_UNREADABLE")


class CopyUnavailable(ValueError):
    def __init__(self):
        super().__init__("COPY_UNAVAILABLE")


def require_extraction(result):
    if not isinstance(result,dict) or result.get("ok") is not True:
        raise ExtractionFailure(result.get("reason") if isinstance(result,dict) else None)


def extract_sandboxed(source,suffix,languages="spa+cat+eng"):
    with source.open("rb") as original, Path(__file__).with_name("knowledge-extract.py").open("rb") as script, Path(__file__).with_name("rdp-extract.py").open("rb") as base:
        args = ["/usr/bin/bwrap","--unshare-all","--die-with-parent","--new-session","--cap-drop","ALL",
                "--uid","65534","--gid","65534","--clearenv","--setenv","PATH","/usr/bin","--setenv","LANG","C.UTF-8",
                "--setenv","OMP_THREAD_LIMIT","1","--ro-bind","/usr","/usr","--ro-bind","/lib","/lib",
                "--ro-bind","/lib64","/lib64","--dir","/proc","--dev","/dev","--tmpfs","/tmp",
                "--perms","0444","--ro-bind-data",str(original.fileno()),"/input",
                "--perms","0444","--ro-bind-data",str(script.fileno()),"/knowledge-extract.py",
                "--perms","0444","--ro-bind-data",str(base.fileno()),"/rdp-extract.py",
                "--chdir","/tmp","/usr/bin/python3","/knowledge-extract.py","--format",suffix,"--ocr-languages",languages]
        try:
            result = subprocess.run(args,pass_fds=(original.fileno(),script.fileno(),base.fileno()),
                                    capture_output=True,timeout=180,check=True)
        except subprocess.TimeoutExpired:
            raise ExtractionFailure("SANDBOX_TIMEOUT") from None
        except subprocess.CalledProcessError:
            raise ExtractionFailure("SANDBOX_PROCESS_FAILED") from None
    if len(result.stdout) > 8*1024*1024:
        raise ExtractionFailure("EXTRACTION_OUTPUT_LIMIT")
    try:
        decoded = json.loads(result.stdout)
    except (ValueError,UnicodeError):
        raise ExtractionFailure("INVALID_EXTRACTION_RESULT") from None
    if not isinstance(decoded,dict) or type(decoded.get("ok")) is not bool:
        raise ExtractionFailure("INVALID_EXTRACTION_RESULT")
    return decoded


def regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid()
            and not info.st_mode & 0o077,"UNSAFE_OBJECT")


def chunks(segments):
    """Keep locators beside text, batching small cells instead of 100k index rows."""
    output, parts, locators, size = [], [], [], 0
    def flush():
        if parts:
            output.append({"locator":locators[0] if len(locators)==1 else locators[0]+" … "+locators[-1],"content":"\n".join(parts)})
    for segment in segments:
        locator, text = segment["locator"], segment["content"]
        require(isinstance(locator,str) and 0 < len(locator) <= 200 and isinstance(text,str),"INVALID_SEGMENT")
        # Character slicing of 4000 guarantees at most 16 KiB of UTF-8.
        for start in range(0,len(text),4000):
            piece = "["+locator+"] "+text[start:start+4000]
            weight = len(piece.encode())+1
            if parts and size+weight > 24*1024:
                flush()
                parts,locators,size = [],[],0
            parts.append(piece)
            locators.append(locator)
            size += weight
    flush()
    return output


def ingest_document(store,root,manifest,document,copy=files.sync.rdp_call,extract=extract_sandboxed):
    files.rdp.select_root(document["source"],manifest["sourceRoots"])
    try:
        receipt = copy(manifest,"copy",document["source"],attempts=1)
    except ValueError as error:
        # Only the transport's fixed failure code is retryable. Policy denial,
        # receipt validation and local storage/parser failures keep their gates.
        if str(error) == "RDP_OPERATION_FAILED":
            raise CopyUnavailable() from None
        raise
    require(receipt.get("bytes") == document["bytes"] and receipt.get("modifiedUtc") == document["modified"],"SOURCE_CHANGED_DURING_COPY")
    digest = receipt.get("verifiedSha256")
    require(isinstance(digest,str) and len(digest)==64 and all(c in "0123456789abcdef" for c in digest)
            and receipt.get("sha256")==digest,"COPY_HASH_MISMATCH")
    original = Path(receipt["destination"])
    require(original.is_absolute() and original.is_relative_to(manifest["importsRoot"])
            and original.resolve()==original,"COPY_OUTSIDE_IMPORTS")
    regular(original)
    require(original.stat().st_size == document["bytes"] and original.stat().st_size <= store.max_file_bytes,"COPY_SIZE_MISMATCH")
    content = original.read_bytes()
    require(hashlib.sha256(content).hexdigest()==digest,"COPY_HASH_MISMATCH")
    objects = root / "objects"
    objects.mkdir(mode=0o700,exist_ok=True)
    files.sync.secure_dir(objects,owner=os.geteuid())
    directory = objects / digest
    directory.mkdir(mode=0o700,exist_ok=True)
    files.sync.secure_dir(directory,owner=os.geteuid())
    saved = directory / "original"
    if saved.exists() or saved.is_symlink():
        regular(saved)
        require(hashlib.sha256(saved.read_bytes()).hexdigest()==digest,"CACHE_HASH_MISMATCH")
    else:
        fd,temporary = tempfile.mkstemp(prefix=".original-",dir=directory)
        try:
            with os.fdopen(fd,"wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary,saved)
            fd = os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    # A hash can occur with different extensions; parsers never share a cache
    # across formats or extractor revisions.
    structured = directory / (document["suffix"][1:]+"-"+EXTRACTOR_REVISION+".json")
    if structured.exists() or structured.is_symlink():
        regular(structured)
        require(structured.stat().st_size <= 8*1024*1024,"CACHE_SIZE_LIMIT")
        result = json.loads(structured.read_text())
    else:
        result = extract(saved,document["suffix"])
        require_extraction(result)
        files.sync.atomic_json(structured,result)
    require(result.get("ok") is True and isinstance(result.get("segments"),list),"CONTENT_UNREADABLE")
    # The verified original and structured tables are immutable host artifacts;
    # employee-facing search still passes through the scope-specific catalogue.
    store.index_document(document["source"],document["fingerprint"],digest,chunks(result["segments"]),structured=result)
    store.record_source_check(store.document(document['source']),{'source':document['source'],'state':'present',
        'bytes':receipt['bytes'],'modifiedUtc':receipt['modifiedUtc'],'sha256':digest})
    return {"sha256":digest,"segments":len(result["segments"]),"tables":len(result.get("tables",[])),"warnings":result.get("warnings",[])}


def retry_schema(store):
    # Private operator metadata only; no changes to reader/publication schemas.
    with store.write():
        store.db.execute("""CREATE TABLE IF NOT EXISTS ingestion_retries (
            document INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
            fingerprint TEXT NOT NULL, attempts INTEGER NOT NULL CHECK(attempts>0),
            next_attempt INTEGER NOT NULL, code TEXT NOT NULL)""")


def record_failure(store,document,code,wall_time):
    with store.write():
        store.db.execute("INSERT INTO issues(recorded,source_key,code) VALUES(?,?,?)",
            (catalogue.now(),document["source_key"],code))
        current=store.db.execute("SELECT 1 FROM documents WHERE id=? AND fingerprint=? AND state='pending'",
            (document["id"],document["fingerprint"])).fetchone()
        if not current:
            return
        state="unreadable"
        if code in RETRYABLE_FAILURES:
            previous=store.db.execute("SELECT attempts FROM ingestion_retries WHERE document=? AND fingerprint=?",
                (document["id"],document["fingerprint"])).fetchone()
            attempts=(previous[0] if previous else 0)+1
            delay=RETRY_DELAYS[attempts-1] if attempts<=len(RETRY_DELAYS) else 0
            if delay:
                state="pending"
            store.db.execute("INSERT OR REPLACE INTO ingestion_retries VALUES(?,?,?,?,?)",
                (document["id"],document["fingerprint"],attempts,int(wall_time)+delay,code))
        store.db.execute("UPDATE documents SET state=?,reason=? WHERE id=? AND fingerprint=? AND state='pending'",
            (state,code,document["id"],document["fingerprint"]))


def batch(store,root,manifest,max_files=5,max_bytes=64*1024*1024,quota_bytes=10*1024**3,copy=files.sync.rdp_call,extract=extract_sandboxed,formats=None,priority_roots=None,seconds=480,clock=time.monotonic,wall_clock=time.time):
    require(type(max_files) is int and 1 <= max_files <= 50 and type(max_bytes) is int and 0 < max_bytes <= 512*1024*1024,"INVALID_BATCH_LIMIT")
    require(type(quota_bytes) is int and 256*1024*1024 <= quota_bytes <= 1024**4,"INVALID_QUOTA")
    require(formats is None or isinstance(formats,list) and 0 < len(formats) <= len(catalogue.FORMATS) and all(f in catalogue.FORMATS for f in formats),"INVALID_FORMAT_FILTER")
    require(type(seconds) is int and 1 <= seconds <= 480,"INVALID_TIME_LIMIT")
    # Include the existing shared transfer cache in the admission budget. No
    # imported originals from another workflow are deleted to reclaim capacity.
    used = sum(p.stat().st_size for directory in [root,Path(manifest["importsRoot"])]
               for p in directory.rglob("*") if p.is_file() and not p.is_symlink())
    processed, transferred, started = 0,0,clock()
    errors = []
    require(priority_roots is None or isinstance(priority_roots,list) and len(priority_roots)<=32,"INVALID_PRIORITY_ROOTS")
    priorities=[]
    for source in priority_roots or []:
        files.rdp.select_root(source,manifest["sourceRoots"])
        priorities.append(catalogue.source_key(source).rstrip('\\'))
    clauses=["(source_key=? OR instr(source_key,?||'\\')=1)" for _ in priorities]
    order="CASE WHEN "+" OR ".join(clauses)+" THEN 0 ELSE 1 END," if clauses else ""
    filter_sql = " AND suffix IN ("+",".join("?" for _ in formats)+")" if formats else ""
    retry_schema(store)
    eligible=" AND NOT EXISTS (SELECT 1 FROM ingestion_retries r WHERE r.document=documents.id AND r.fingerprint=documents.fingerprint AND r.next_attempt>?)"
    values=(int(wall_clock()),max_bytes)+tuple(formats or [])+tuple(p for priority in priorities for p in [priority]*2)+(max_files,)
    # Preserve business priority, then discovery order. New small files must not
    # indefinitely displace older PDFs/tables; per-file and batch byte caps still
    # govern admission below, independently of queue order.
    for row in store.db.execute("SELECT * FROM documents WHERE state='pending'"+eligible+" AND bytes<=?"+filter_sql+" ORDER BY "+order+"id LIMIT ?",values).fetchall():
        document = dict(row)
        # This is an admission window, not an interrupt: finish the current
        # verified copy/extraction, but never start another after the budget.
        # Transport and sandbox retain their independent per-file timeouts.
        if clock()-started >= seconds:
            return {"processed":processed,"transferredBudgetBytes":transferred,"paused":"BATCH_TIME_LIMIT","errors":errors}
        # Reserve original, structured output, index expansion, transfer receipt
        # and a conservative free-space margin before opening an RDP copy.
        reserve = document["bytes"]*2 + 32*1024*1024
        if used+reserve > quota_bytes or shutil.disk_usage(root).free < reserve+512*1024*1024:
            return {"processed":processed,"paused":"STORAGE_QUOTA","errors":errors}
        if transferred+document["bytes"] > max_bytes:
            break
        try:
            ingest_document(store,root,manifest,document,copy,extract)
        except BlockingIOError:
            return {"processed":processed,"paused":"SOURCE_BUSY","errors":errors}
        except Exception as error:
            code = str(error) if isinstance(error,ValueError) else "INGESTION_UNAVAILABLE"
            if not isinstance(error,(ExtractionFailure,CopyUnavailable)) and code not in {"SOURCE_CHANGED_DURING_COPY","COPY_HASH_MISMATCH","CACHE_HASH_MISMATCH","CONTENT_UNREADABLE","RDP_DRIVE_REDIRECTION_DISABLED","SOURCE_VERSION_CHANGED"}:
                code = "INGESTION_UNAVAILABLE"
            errors.append(code)
            record_failure(store,document,code,wall_clock())
            if code in {"RDP_DRIVE_REDIRECTION_DISABLED","CACHE_HASH_MISMATCH","COPY_HASH_MISMATCH"}:
                raise ValueError(code)
        else:
            with store.write():
                store.db.execute("DELETE FROM ingestion_retries WHERE document=? AND fingerprint=?",
                    (document["id"],document["fingerprint"]))
            processed += 1
        transferred += document["bytes"]
        used += reserve
    return {"processed":processed,"transferredBudgetBytes":transferred,"errors":errors}


def requeue_supported(store,formats):
    require(isinstance(formats,list) and 0 < len(formats) <= len(catalogue.FORMATS)
        and all(f in catalogue.FORMATS for f in formats),"INVALID_FORMAT_FILTER")
    # Explicit operator migration for newly supported formats. Never reactivate
    # withdrawn/denied sources or retry unreadable documents as a side effect.
    with store.write():
        return store.db.execute("UPDATE documents SET state='pending',reason=NULL WHERE state='unsupported'"
            " AND reason='FORMAT_OR_SIZE_UNSUPPORTED' AND bytes<=? AND suffix IN ("+
            ','.join('?' for _ in formats)+')',(store.max_file_bytes,*formats)).rowcount


def requeue_unreadable(store,formats=None):
    retry_schema(store)
    clause=" AND suffix IN ("+",".join("?" for _ in formats)+")" if formats else ""
    values=tuple(formats or [])
    with store.write():
        # A deliberate operator retry resets its budget, but cannot clear a
        # recorded policy/integrity stop. Those require separate investigation.
        selected="SELECT id FROM documents WHERE state='unreadable' AND reason NOT IN ('RDP_DRIVE_REDIRECTION_DISABLED','COPY_HASH_MISMATCH','CACHE_HASH_MISMATCH')"+clause
        store.db.execute("DELETE FROM ingestion_retries WHERE document IN ("+selected+")",values)
        return store.db.execute("UPDATE documents SET state='pending',reason=NULL WHERE id IN ("+selected+")",values).rowcount


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest",required=True)
    parser.add_argument("--max-files",type=int,default=5)
    parser.add_argument("--seconds",type=int,default=480,help="Stop admitting new files after this many seconds (1-480); finish the current file")
    parser.add_argument("--quota-bytes",type=int,default=10*1024**3)
    parser.add_argument("--format",action="append",choices=sorted(catalogue.FORMATS))
    parser.add_argument("--retry-unreadable",action="store_true")
    parser.add_argument("--requeue-supported",action="store_true",help="Requeue previously unsupported files for explicitly selected --format values")
    parser.add_argument("--priority-manifest",help="Prioritize business folders from the existing approved mirror")
    args = parser.parse_args()
    require(os.geteuid()==0,"HOST_OPERATOR_REQUIRED")
    os.umask(0o077)
    manifest = files.sync.load_manifest(args.manifest)
    root = Path("/var/lib/aibrain/knowledge") / manifest["installationId"] / "operator"
    store = catalogue.Catalogue(root,manifest["installationId"],"operator",manifest["maxFileBytes"])
    fd = os.open(root/"inventory.lock",os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        regular(root/"inventory.lock")
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"processed":0,"paused":"CATALOGUE_BUSY"}))
            return
        if args.requeue_supported:
            require(bool(args.format),"EXPLICIT_REQUEUE_FORMAT_REQUIRED")
            print(json.dumps({"requeuedSupported":requeue_supported(store,args.format)}))
        if args.retry_unreadable:
            print(json.dumps({"requeuedUnreadable":requeue_unreadable(store,args.format)}))
        priority=files.sync.load_manifest(args.priority_manifest)["sourceRoots"] if args.priority_manifest else None
        print(json.dumps(batch(store,root,manifest,max_files=args.max_files,quota_bytes=args.quota_bytes,formats=args.format,priority_roots=priority,seconds=args.seconds)))
    finally:
        os.close(fd)
        store.close()


if __name__ == "__main__":
    main()
