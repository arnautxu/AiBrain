#!/usr/bin/env python3
"""Real Linux parser/OCR acceptance using generated fictional fixtures only."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile
import zlib

spec = importlib.util.spec_from_file_location("knowledge_ingest",Path(__file__).with_name("knowledge-ingest.py"))
ingest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)


def pdf(objects):
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number,obj in enumerate(objects,1):
        offsets.append(len(data))
        data.extend(f"{number} 0 obj\n".encode()+obj+b"\nendobj\n")
    start = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(data)


def text_pdf():
    first = b"BT /F1 24 Tf 50 700 Td (Contrato de mantenimiento) Tj ET"
    second = b"BT /F1 24 Tf 50 700 Td (Importe total 1250 EUR) Tj ET"
    return pdf([b"<< /Type /Catalog /Pages 2 0 R >>",b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(first)} >>\nstream\n".encode()+first+b"\nendstream",
        f"<< /Length {len(second)} >>\nstream\n".encode()+second+b"\nendstream"])


def scanned_pdf(source,folder):
    target = folder/"raster"
    subprocess.run(["/usr/bin/pdftoppm","-f","1","-l","1","-r","120","-singlefile",str(source),str(target)],check=True,capture_output=True,timeout=30)
    raw = target.with_suffix(".ppm").read_bytes()
    magic,dimensions,maximum,pixels = raw.split(b"\n",3)
    assert magic == b"P6" and maximum == b"255"
    width,height = map(int,dimensions.split())
    assert len(pixels)==width*height*3
    compressed = zlib.compress(pixels)
    content = b"q 612 0 0 792 0 0 cm /Im1 Do Q"
    return pdf([b"<< /Type /Catalog /Pages 2 0 R >>",b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
        f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {len(compressed)} >>\nstream\n".encode()+compressed+b"\nendstream",
        f"<< /Length {len(content)} >>\nstream\n".encode()+content+b"\nendstream"])


def main():
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="knowledge-acceptance-") as temporary:
        folder = Path(temporary)
        sources = {}
        sources["pdf"] = folder/"text.pdf"
        sources["pdf"].write_bytes(text_pdf())
        sources["ocr"] = folder/"scanned.pdf"
        sources["ocr"].write_bytes(scanned_pdf(sources["pdf"],folder))
        sources["docx"] = folder/"fixture.docx"
        with zipfile.ZipFile(sources["docx"],"w") as archive:
            archive.writestr("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento de prueba ficticio</w:t></w:r></w:p></w:body></w:document>')
        sources["xlsx"] = folder/"fixture.xlsx"
        with zipfile.ZipFile(sources["xlsx"],"w") as archive:
            archive.writestr("xl/workbook.xml",'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ventas" sheetId="1" r:id="rId1"/></sheets></workbook>')
            archive.writestr("xl/_rels/workbook.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
            archive.writestr("xl/worksheets/sheet1.xml",'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>12.50</v></c><c r="B1"><f>A1*2</f><v>25</v></c></row></sheetData></worksheet>')
        sources["csv"] = folder/"fixture.csv"
        sources["csv"].write_text('Articulo,Importe\nEjemplo,12.50\n')
        results = {}
        for kind,source in sources.items():
            result = ingest.extract_sandboxed(source,source.suffix)
            assert result.get("ok") is True,(kind,result.get("reason"))
            results[kind] = result
        assert [s["locator"] for s in results["pdf"]["segments"]]==["page:1","page:2"]
        assert "1250" in results["pdf"]["segments"][1]["content"]
        assert "contrato" in results["ocr"]["segments"][0]["content"].lower()
        assert any(w["code"]=="OCR_TEXT_REQUIRES_VERIFICATION" for w in results["ocr"]["warnings"])
        assert results["docx"]["segments"][0]["locator"]=="paragraph:1"
        assert results["xlsx"]["tables"][0]["cells"][1]["formula"]=="A1*2"
        assert results["xlsx"]["segments"][1]["locator"]=="sheet:Ventas!B1"
        assert results["csv"]["tables"][0]["rows"][1]==["Ejemplo","12.50"]
        receipt = {"ok":True,"fixtures":"fictional","networklessExtractor":True,
                   "formats":{kind:{"sha256":hashlib.sha256(sources[kind].read_bytes()).hexdigest(),
                                    "segments":len(result["segments"]),"tables":len(result["tables"]),
                                    "warnings":result["warnings"]} for kind,result in results.items()}}
        print(json.dumps(receipt))


if __name__ == "__main__":
    main()
