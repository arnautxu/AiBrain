#!/usr/bin/env python3
"""Bounded text extraction; invoked in a networkless, unprivileged sandbox."""
import argparse
import datetime as dt
import json
import math
from pathlib import Path
import re
import resource
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

MAX_INPUT = 16 * 1024 * 1024
MAX_TEXT = 2 * 1024 * 1024
MAX_XML = 24 * 1024 * 1024
FORMATS = {".pdf", ".docx", ".xlsx", ".xlsm", ".txt", ".csv", ".md", ".json"}
SECRET = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*|\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*[\"']?[A-Za-z0-9._~+/-]{16,}", re.I)


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def xml(archive, name):
    item = archive.getinfo(name)
    require(item.file_size <= MAX_XML, "XML_TOO_LARGE")
    data = archive.read(item)
    require(b"\x00" not in data, "XML_ENCODING_REJECTED")
    require(b"<!DOCTYPE" not in data.upper() and b"<!ENTITY" not in data.upper(), "XML_ENTITY_REJECTED")
    return ET.fromstring(data)


def spreadsheet(archive):
    """XML values only: no VBA, external links or formula evaluation."""
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    relns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    workbook = xml(archive, "xl/workbook.xml")
    targets = {}
    for rel in xml(archive, "xl/_rels/workbook.xml.rels"):
        target = rel.get("Target", "")
        if target.startswith("/xl/"):
            target = target[4:]
        if rel.get("TargetMode") != "External" and re.fullmatch(r"worksheets/[A-Za-z0-9_.-]+\.xml", target):
            targets[rel.get("Id")] = "xl/" + target
    strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        strings = ["".join(n.text or "" for n in item.iter(ns + "t"))
                   for item in xml(archive, "xl/sharedStrings.xml").iter(ns + "si")]
    formats = {14: "mm-dd-yy", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm", 46: "[h]:mm:ss"}
    styles = []
    if "xl/styles.xml" in archive.namelist():
        style = xml(archive, "xl/styles.xml")
        formats.update({int(n.get("numFmtId")): n.get("formatCode", "") for n in style.iter(ns + "numFmt")})
        xfs = style.find(ns + "cellXfs")
        styles = [int(n.get("numFmtId", "0")) for n in xfs] if xfs is not None else []
    properties = workbook.find(ns + "workbookPr")
    date1904 = properties is not None and properties.get("date1904") in {"1", "true"}
    sheets = list(workbook.iter(ns + "sheet"))
    require(0 < len(sheets) <= 100, "SHEET_LIMIT")
    preview = {"schemaVersion": 1, "kind": "spreadsheet", "sheets": [], "truncated": False}
    budget = sum(len(sheet.get("name", "").encode("utf-8")) + 100 for sheet in sheets)
    visible_count = sum(sheet.get("state", "visible") == "visible" for sheet in sheets)
    hidden_count = len(sheets) - visible_count
    data_budget = 60000 - budget
    count, text_bytes = 0, 0
    lines = ["Valores guardados; macros desactivadas, fórmulas no recalculadas. Formatos no reconocidos: valor original."]
    for sheet in sheets:
        name = sheet.get("name", "")
        require(0 < len(name) <= 100, "INVALID_SHEET_NAME")
        target = targets.get(sheet.get(relns + "id"))
        require(target is not None, "INVALID_SHEET_TARGET")
        view = {"name": name, "hidden": sheet.get("state", "visible") != "visible", "cells": []}
        # A large hidden template must not starve the actual visible schedules.
        # Reserve a bounded share for every sheet while preserving workbook order.
        group_count = hidden_count if view["hidden"] else visible_count
        share = (0.05 if view["hidden"] else 0.95) if visible_count and hidden_count else 1
        sheet_limit, sheet_bytes = int(data_budget * share / group_count), 0
        preview["sheets"].append(view)
        lines.append("\nHoja: " + name + (" (oculta)" if view["hidden"] else ""))
        seen = set()
        for cell in xml(archive, target).iter(ns + "c"):
            count += 1
            # Excel may retain hundreds of thousands of style-only cells.
            # The XML/archive, CPU and memory bounds still apply independently.
            require(count <= 1000000, "CELL_LIMIT")
            address = cell.get("r", "")
            require(re.fullmatch(r"[A-Z]{1,3}[1-9][0-9]{0,6}", address) and address not in seen, "INVALID_CELL_ADDRESS")
            seen.add(address)
            value = cell.findtext(ns + "v", "")
            if cell.get("t") == "s":
                require(value.isdigit() and int(value) < len(strings), "INVALID_SHARED_STRING")
                value = strings[int(value)]
            elif cell.get("t") == "inlineStr":
                value = "".join(n.text or "" for n in cell.iter(ns + "t"))
            elif cell.get("t") == "b":
                value = "TRUE" if value == "1" else "FALSE"
            elif value and cell.get("t", "n") == "n":
                index = int(cell.get("s", "0"))
                code = formats.get(styles[index], "").lower() if 0 <= index < len(styles) else ""
                # Small explicit display subset; unknown formats retain original values.
                if code in {"h:mm", "hh:mm", "h:mm:ss", "hh:mm:ss", "[h]:mm:ss", "mm-dd-yy", "m/d/yy h:mm"}:
                    number = float(value)
                    require(math.isfinite(number) and 0 <= number < 2958466, "INVALID_DATE_VALUE")
                    seconds = round(number * 86400)
                    if code in {"mm-dd-yy", "m/d/yy h:mm"}:
                        if not date1904 and int(number) == 60:
                            value = "1900-02-29"
                            if code == "m/d/yy h:mm":
                                value += f" {seconds // 3600 % 24:02d}:{seconds // 60 % 60:02d}"
                        else:
                            epoch = dt.datetime(1904, 1, 1) if date1904 else dt.datetime(1899, 12, 31)
                            date = epoch + dt.timedelta(seconds=seconds - (86400 if not date1904 and number >= 60 else 0))
                            value = date.strftime("%Y-%m-%d" if code == "mm-dd-yy" else "%Y-%m-%d %H:%M")
                    else:
                        hours = seconds // 3600 if code.startswith("[h]") else seconds // 3600 % 24
                        value = f"{hours:02d}:{seconds // 60 % 60:02d}" + (f":{seconds % 60:02d}" if "ss" in code else "")
            if cell.find(ns + "f") is not None and not value:
                value = "[Fórmula sin valor guardado]"
            if not value:
                continue
            line = f"{address}: {value}"
            text_bytes += len(line.encode("utf-8")) + 1
            require(text_bytes <= MAX_TEXT, "TEXT_TOO_LARGE")
            lines.append(line)
            entry = {"address": address, "value": value}
            size = len(json.dumps(entry, ensure_ascii=False).encode("utf-8"))
            if budget + size <= 60000 and sheet_bytes + size <= sheet_limit and len(view["cells"]) < 2000:
                view["cells"].append(entry)
                budget += size
                sheet_bytes += size
            else:
                preview["truncated"] = True
    return "\n".join(lines), preview


def extract(source, suffix, preview_result=None):
    require(suffix in FORMATS and source.stat().st_size <= MAX_INPUT, "FORMAT_OR_SIZE_REJECTED")
    if suffix == ".pdf":
        # A regular temporary output makes RLIMIT_FSIZE effective for Poppler.
        output = Path("/tmp/extracted.txt")
        subprocess.run(["/usr/bin/pdftotext", "-layout", "-enc", "UTF-8", "-nopgbrk", str(source), str(output)],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=True, timeout=25)
        require(output.stat().st_size <= MAX_TEXT, "TEXT_TOO_LARGE")
        text = output.read_text(encoding="utf-8")
    elif suffix in {".docx", ".xlsx", ".xlsm"}:
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            require(len(infos) <= 5000 and sum(i.file_size for i in infos) <= 64 * 1024 * 1024,
                    "ARCHIVE_TOO_LARGE")
            require(len({i.filename for i in infos}) == len(infos), "DUPLICATE_ARCHIVE_MEMBER")
            if suffix == ".docx":
                root = xml(archive, "word/document.xml")
                ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
                text = "\n".join("".join((n.text or "") if n.tag == ns + "t" else
                                         "\t" if n.tag == ns + "tab" else
                                         "\n" if n.tag in {ns + "br", ns + "cr"} else ""
                                         for n in p.iter()) for p in root.iter(ns + "p"))
            else:
                text, preview = spreadsheet(archive)
                if preview_result is not None:
                    preview_result.update(preview)
    else:
        raw = source.read_bytes()
        require(len(raw) <= MAX_TEXT, "TEXT_TOO_LARGE")
        text = raw.decode("utf-8-sig")
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    require(text and len(text.encode("utf-8")) <= MAX_TEXT, "EMPTY_OR_OVERSIZED_TEXT")
    require(not any(ord(c) < 32 and c not in "\n\t" for c in text), "BINARY_CONTENT")
    require(not SECRET.search(text), "CREDENTIAL_SHAPED_CONTENT")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", required=True, choices=sorted(FORMATS))
    args = parser.parse_args()
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_TEXT + 1,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    try:
        preview = {}
        result = {"ok": True, "text": extract(Path("/input"), args.format, preview)}
        if preview:
            result["preview"] = preview
    except Exception as error:
        result = {"ok": False, "reason": str(error) if isinstance(error, ValueError) else type(error).__name__}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
