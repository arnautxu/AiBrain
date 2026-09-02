#!/usr/bin/env python3
"""Bounded text extraction; invoked in a networkless, unprivileged sandbox."""
import argparse
import json
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
FORMATS = {".pdf", ".docx", ".xlsx", ".txt", ".csv", ".md", ".json"}
SECRET = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*|\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*[\"']?[A-Za-z0-9._~+/-]{16,}", re.I)


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def xml(archive, name):
    item = archive.getinfo(name)
    require(item.file_size <= MAX_XML, "XML_TOO_LARGE")
    data = archive.read(item)
    require(b"<!DOCTYPE" not in data.upper() and b"<!ENTITY" not in data.upper(), "XML_ENTITY_REJECTED")
    return ET.fromstring(data)


def extract(source, suffix):
    require(suffix in FORMATS and source.stat().st_size <= MAX_INPUT, "FORMAT_OR_SIZE_REJECTED")
    if suffix == ".pdf":
        # A regular temporary output makes RLIMIT_FSIZE effective for Poppler.
        output = Path("/tmp/extracted.txt")
        subprocess.run(["/usr/bin/pdftotext", "-layout", "-enc", "UTF-8", "-nopgbrk", str(source), str(output)],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=True, timeout=25)
        require(output.stat().st_size <= MAX_TEXT, "TEXT_TOO_LARGE")
        text = output.read_text(encoding="utf-8")
    elif suffix in {".docx", ".xlsx"}:
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
                ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                strings = []
                if "xl/sharedStrings.xml" in archive.namelist():
                    strings = ["".join(n.text or "" for n in item.iter(ns + "t"))
                               for item in xml(archive, "xl/sharedStrings.xml").iter(ns + "si")]
                sheets = sorted(n for n in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet[0-9]+\.xml", n))
                require(0 < len(sheets) <= 100, "SHEET_LIMIT")
                lines = ["Full de calcul: valors desats; les formules no s'han recalculat."]
                cells = 0
                for name in sheets:
                    lines.append("\n" + name.rsplit("/", 1)[-1])
                    for row in xml(archive, name).iter(ns + "row"):
                        values = []
                        for cell in row.findall(ns + "c"):
                            cells += 1
                            require(cells <= 100000, "CELL_LIMIT")
                            value = cell.findtext(ns + "v", "")
                            if cell.get("t") == "s":
                                require(value.isdigit() and int(value) < len(strings), "INVALID_SHARED_STRING")
                                value = strings[int(value)]
                            elif cell.get("t") == "inlineStr":
                                value = "".join(n.text or "" for n in cell.iter(ns + "t"))
                            values.append(f"{cell.get('r', '?')}: {value}")
                        lines.append(" | ".join(values))
                text = "\n".join(lines)
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
        result = {"ok": True, "text": extract(Path("/input"), args.format)}
    except Exception as error:
        result = {"ok": False, "reason": str(error) if isinstance(error, ValueError) else type(error).__name__}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
