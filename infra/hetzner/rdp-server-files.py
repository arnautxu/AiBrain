#!/usr/bin/env python3
"""Read-only, bounded server browsing using the operator's existing RDP route."""
import base64
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import ntpath
from pathlib import Path
import re
import secrets
import shutil
import urllib.parse

spec = importlib.util.spec_from_file_location("rdp_sync", Path(__file__).with_name("rdp-sync.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
rdp = sync.rdp


def virtual_path(connection, source):
    source = rdp.windows_path(source)
    return "server-" + connection + "/" + source[0].upper() + "/" + "/".join(
        urllib.parse.quote(p, safe="") for p in source[3:].split("\\") if p)


def source_path(connection, value):
    rdp.require(isinstance(value, str) and len(value) <= 1024, "INVALID_SERVER_PATH")
    prefix = "server-" + connection + "/"
    rdp.require(value.startswith(prefix), "WRONG_SERVER_CONNECTION")
    raw, separator, query = value[len(prefix):].partition("?")
    parts = raw.rstrip("/").split("/")
    rdp.require(parts and re.fullmatch("[A-Za-z]", parts[0]), "INVALID_SERVER_DRIVE")
    decoded = [urllib.parse.unquote(p, errors="strict") for p in parts[1:]]
    rdp.require(all(p and "/" not in p and "\\" not in p for p in decoded), "INVALID_SERVER_SEGMENT")
    page = 1
    if separator:
        rdp.require(re.fullmatch(r"part=[1-9][0-9]{0,2}", query), "INVALID_SERVER_PART")
        page = int(query[5:])
    return rdp.windows_path(parts[0].upper() + ":\\" + "\\".join(decoded)), page


def query_request(query, limit):
    rdp.require(isinstance(query, str) and 0 < len(query.strip()) <= 200 and
                not any(ord(c) < 32 for c in query), "INVALID_SERVER_QUERY")
    rdp.require(type(limit) is int and 1 <= limit <= 50, "INVALID_SERVER_LIMIT")
    query = query.strip()
    if re.match(r"^[A-Za-z]:[\\/]", query):
        # Windows paths pasted by the employee are still validated as data.
        query = "server:/" + query[0].upper() + "/" + query[3:].replace("\\", "/")
    if query.startswith("server:/"):
        raw, sep, options = query[8:].partition("?")
        offset = 0
        if sep:
            rdp.require(re.fullmatch(r"offset=[0-9]{1,6}", options), "INVALID_SERVER_OFFSET")
            offset = int(options[7:])
        if not raw:
            rdp.require(not sep, "INVALID_DRIVE_QUERY")
            return {"mode": "drives", "limit": limit, "offset": 0}
        source, _ = source_path("query", "server-query/" + raw)
        return {"mode": "list", "source": source, "limit": limit, "offset": offset}
    rdp.require("/" not in query and "\\" not in query, "INVALID_SERVER_QUERY")
    return {"mode": "search", "query": query, "limit": limit, "offset": 0}


def command(request, access, nonce):
    data = {**request, "roots": access["readRoots"], "nonce": nonce}
    encoded = base64.b64encode(json.dumps(data).encode()).decode()
    # Fixed program; all employee paths and terms are encoded JSON data.
    script = "$ErrorActionPreference='Stop';try{$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "'))|ConvertFrom-Json;"
    script += r"""
function Safe($p){$p=[IO.Path]::GetFullPath($p);$ok=$false;foreach($b in $d.roots){$b=$b.TrimEnd('\');if($p-eq$b-or$p.StartsWith($b+'\',[StringComparison]::OrdinalIgnoreCase)){$ok=$true}};if(!$ok){throw 'Scope'};$drive=Get-PSDrive -Name $p.Substring(0,1);if($drive.DisplayRoot-like '\\tsclient\*'){throw 'Redirected'};$c=$p;while($c){$i=Get-Item -Force -LiteralPath $c;if($i.Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'Reparse'};$c=[IO.Path]::GetDirectoryName($c)};return $p}
function Entry($i){@{source=$i.FullName;name=$i.Name;directory=$i.PSIsContainer;bytes=$(if($i.PSIsContainer){0}else{$i.Length});modifiedUtc=$i.LastWriteTimeUtc.ToString('o')}}
$dr=@(Get-PSDrive -PSProvider FileSystem|Where-Object{$_.Name-match '^[A-Za-z]$'-and$_.DisplayRoot-notlike '\\tsclient\*'});$out=@();$partial=$false;$denied=0;$next=$null;
"""
    if request["mode"] == "drives":
        script += r"""foreach($v in $dr){try{$p=Safe $v.Root;$out+=@{source=$p;name=$v.Name;directory=$true;bytes=0;modifiedUtc=$null}}catch{}}"""
    elif request["mode"] == "list":
        script += r"""$p=Safe $d.source;$a=@(Get-ChildItem -Force -LiteralPath $p|Sort-Object Name|Select-Object -Skip $d.offset -First ($d.limit+1));$partial=$a.Count-gt$d.limit;$out=@($a|Select-Object -First $d.limit|ForEach-Object{Entry $_});if($partial){$next=$d.offset+$d.limit}"""
    else:
        script += r"""$q=New-Object 'Collections.Generic.Queue[string]';foreach($b in $d.roots){if($dr.Name-contains$b.Substring(0,1)){$q.Enqueue($b)}};$clock=[Diagnostics.Stopwatch]::StartNew();$n=0;$seen=0;while($q.Count-and$out.Count-lt$d.limit-and$n-lt500-and$seen-lt20000-and$clock.Elapsed.TotalSeconds-lt15){$p=$q.Dequeue();$n++;try{$p=Safe $p;$a=@(Get-ChildItem -Force -LiteralPath $p|Select-Object -First 10001);if($a.Count-gt10000){$partial=$true};foreach($i in $a){$seen++;if($i.Attributes-band[IO.FileAttributes]::ReparsePoint){continue};if($i.Name.IndexOf($d.query,[StringComparison]::OrdinalIgnoreCase)-ge0){$out+=Entry $i};if($i.PSIsContainer){$q.Enqueue($i.FullName)};if($out.Count-ge$d.limit-or$seen-ge20000){$partial=$true;break}}}catch{$denied++}};if($q.Count){$partial=$true}"""
    script += r""";
$r=@{ok=$true;entries=@($out);truncated=$partial;denied=$denied;nextOffset=$next}
}catch{$r=@{ok=$false;error='WINDOWS_PATH_UNAVAILABLE'}};$r.nonce=$d.nonce;$j=$r|ConvertTo-Json -Depth 5 -Compress;Set-Clipboard -Value $j
"""
    command = "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " + base64.b64encode(script.encode("utf-16le")).decode()
    rdp.require(len(command) <= 7800, "SERVER_QUERY_TOO_LARGE")
    return command


def browse(manifest, request):
    config, credentials, access, destination = rdp.load_config(manifest["connectionConfig"], manifest["accessManifest"])
    if request.get("source"):
        rdp.select_root(request["source"], access["readRoots"])
    nonce = secrets.token_hex(16)
    program = command(request, access, nonce)
    with (destination / ".operator.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        job = destination / (dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + nonce[:12])
        job.mkdir(mode=0o700)
        with rdp.RdpSession(config, credentials, access["target"], job) as session:
            result = session.execute(program, nonce, timeout=45)
        result["recordedAt"] = sync.now()
        sync.atomic_json(job / "receipt.json", result)
        rdp.require(result.get("ok") is True, "WINDOWS_PATH_UNAVAILABLE")
    return result


def search(manifest, query, limit, run=browse):
    request = query_request(query, limit)
    result = run(manifest, request)
    rdp.require(result.get("ok") is True and isinstance(result.get("entries"), list)
                and len(result["entries"]) <= max(limit, 26), "INVALID_SERVER_LISTING")
    entries, filtered = [], 0
    for item in result["entries"]:
        try:
            source, _ = rdp.select_root(item["source"], manifest["sourceRoots"])
            if request["mode"] == "list":
                rdp.require(ntpath.normcase(ntpath.dirname(source)) == ntpath.normcase(request["source"].rstrip("\\"))
                            or ntpath.normcase(ntpath.dirname(source)) == ntpath.normcase(request["source"]), "WRONG_LIST_PARENT")
            rdp.require(type(item["directory"]) is bool and type(item["bytes"]) is int and item["bytes"] >= 0, "INVALID_ENTRY")
            entries.append({"path": virtual_path(manifest["connectionId"], source), "source": source,
                            "kind": "directory" if item["directory"] else "file", "size": item["bytes"],
                            "modifiedAt": item.get("modifiedUtc"), "scope": "company"})
        except (KeyError, ValueError, TypeError):
            filtered += 1
    next_query = None
    if type(result.get("nextOffset")) is int and request["mode"] == "list":
        next_query = "server:/" + virtual_path(manifest["connectionId"], request["source"]).split("/", 1)[1] + "?offset=" + str(result["nextOffset"])
    return {"available": True, "checkedAt": result["recordedAt"], "results": entries,
            "truncated": bool(result.get("truncated")), "nextQuery": next_query,
            "limited": bool(result.get("truncated") or result.get("denied") or filtered),
            "warning": "La búsqueda recursiva es limitada; navega por server:/ y las carpetas para comprobar una ubicación concreta. No interpretes un resultado vacío como ausencia en todo el servidor." if request["mode"] == "search" else None}


def read(manifest, path, call=sync.rdp_call, extract=sync.extract_sandboxed):
    source, page = source_path(manifest["connectionId"], path)
    rdp.select_root(source, manifest["sourceRoots"])
    rdp.require(ntpath.splitext(source)[1].lower() in sync.FORMATS, "SERVER_FORMAT_NOT_READABLE")
    rdp.require(shutil.disk_usage(manifest["importsRoot"]).free >= 512 * 1024 * 1024 + manifest["maxFileBytes"] * 2,
                "SERVER_COPY_SPACE_UNAVAILABLE")
    # Read fresh bytes; never return an old copy as the current server version.
    receipt = call(manifest, "copy", source, attempts=1)
    original = Path(receipt["destination"])
    digest = receipt.get("verifiedSha256")
    rdp.require(original.is_relative_to(manifest["importsRoot"]) and original.resolve() == original
                and original.is_file() and not original.is_symlink()
                and isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest)
                and receipt.get("sha256") == digest
                and hashlib.sha256(original.read_bytes()).hexdigest() == digest, "INVALID_SERVER_COPY")
    result = extract(original, ntpath.splitext(source)[1].lower())
    rdp.require(result.get("ok") is True and isinstance(result.get("text"), str), "SERVER_TEXT_UNAVAILABLE")
    chunks = list(sync.text_chunks(result["text"]))
    rdp.require(0 < page <= len(chunks), "SERVER_PART_UNAVAILABLE")
    base = virtual_path(manifest["connectionId"], source)
    return {"available": True, "scope": "company", "path": path, "source": source,
            "size": receipt["bytes"], "sha256": receipt["sha256"], "checkedAt": receipt["recordedAt"],
            "modifiedAt": receipt["modifiedUtc"], "content": chunks[page-1], "part": page, "parts": len(chunks),
            "nextPath": base + "?part=" + str(page+1) if page < len(chunks) else None}
