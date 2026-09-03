#!/usr/bin/env python3
"""Bounded, source-located extraction. Run inside the networkless host sandbox."""
import argparse
import csv
from decimal import Decimal
from html.parser import HTMLParser
import importlib.util
import io
import json
import math
from pathlib import Path
import re
import resource
import struct
import subprocess
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location("base_extractor", Path(__file__).with_name("rdp-extract.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
require = base.require
MAX_TEXT = 2 * 1024 * 1024
MAX_PAGES = 250
MAX_OCR_PAGES = 20
IMAGE_FORMATS={'.png','.jpg','.jpeg','.bmp'}
FORMATS = base.FORMATS | {".xls", ".doc", ".rtf"} | IMAGE_FORMATS


def image_dimensions(source,suffix):
    """Read bounded raster headers before invoking a native decoder.

    Reject text/list files disguised as images, and cap decoded pixel dimensions.
    Decoder validation still runs inside the existing resource-limited sandbox.
    """
    raw=source.read_bytes();width=height=0
    try:
        if suffix=='.png':
            require(raw[:8]==b'\x89PNG\r\n\x1a\n' and raw[8:16]==b'\x00\x00\x00\rIHDR','IMAGE_SIGNATURE_REQUIRED')
            width,height=struct.unpack('>II',raw[16:24])
        elif suffix=='.bmp':
            require(raw[:2]==b'BM','IMAGE_SIGNATURE_REQUIRED')
            dib=struct.unpack('<I',raw[14:18])[0]
            if dib==12:width,height=struct.unpack('<HH',raw[18:22])
            else:
                require(dib>=40 and len(raw)>=14+dib,'IMAGE_SIGNATURE_REQUIRED')
                width,height=struct.unpack('<ii',raw[18:26]);height=abs(height)
        else:
            require(raw[:2]==b'\xff\xd8','IMAGE_SIGNATURE_REQUIRED')
            offset=2
            while offset<len(raw):
                require(raw[offset]==255,'IMAGE_SIGNATURE_REQUIRED')
                while offset<len(raw) and raw[offset]==255:offset+=1
                marker=raw[offset];offset+=1
                require(marker not in {0,0xd9,0xda},'IMAGE_SIGNATURE_REQUIRED')
                if marker in {0x01,*range(0xd0,0xd9)}:continue
                size=struct.unpack('>H',raw[offset:offset+2])[0]
                require(size>=2 and offset+size<=len(raw),'IMAGE_SIGNATURE_REQUIRED')
                if marker in {0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf}:
                    require(size>=8,'IMAGE_SIGNATURE_REQUIRED')
                    height,width=struct.unpack('>HH',raw[offset+3:offset+7]);break
                offset+=size
        require(width>0 and height>0,'IMAGE_SIGNATURE_REQUIRED')
    except (IndexError,struct.error):raise ValueError('IMAGE_SIGNATURE_REQUIRED') from None
    require(width<=25000 and height<=25000 and width*height<=40000000,'OCR_PIXEL_LIMIT')
    return width,height


def checked_text(value):
    require(isinstance(value,str) and not base.SECRET.search(value),"CREDENTIAL_SHAPED_CONTENT")
    require(not any(ord(c) < 32 and c not in "\n\r\t" for c in value),"BINARY_CONTENT")
    return value


def command(args, timeout=30):
    subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL,check=True,timeout=timeout)


def read_output(path, max_bytes=MAX_TEXT):
    require(path.stat().st_size <= max_bytes,"TEXT_TOO_LARGE")
    return path.read_text(encoding="utf-8")


def capture_text(args,path):
    # A regular bounded sandbox file makes RLIMIT_FSIZE apply to the converter.
    with path.open('wb') as output:
        subprocess.run(args,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.DEVNULL,
            check=True,timeout=45)
    return read_output(path)


class RtfHtml(HTMLParser):
    """Parse converter output as inert data; never render or follow links."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks=[];self.parts=[];self.tables=[];self.table=None;self.row=None;self.cell=None
        self.skip=0;self.count=0

    def flush(self):
        value=''.join(self.parts).strip();self.parts=[]
        if value:self.blocks.append(checked_text(value))

    def handle_starttag(self,tag,attrs):
        if tag in {'head','script','style'}:self.skip+=1;return
        if self.skip:return
        if tag in {'p','div','br','table','tr','td','th'}:self.flush()
        if tag=='br' and self.cell is not None:self.cell.append('\n')
        if tag=='table':
            require(self.table is None and len(self.tables)<100,'RTF_TABLE_STRUCTURE')
            self.table=[]
        elif tag=='tr':
            require(self.table is not None and self.row is None,'RTF_TABLE_STRUCTURE');self.row=[]
        elif tag in {'td','th'}:
            require(self.row is not None and self.cell is None,'RTF_TABLE_STRUCTURE');self.cell=[]

    def handle_endtag(self,tag):
        if tag in {'head','script','style'}:self.skip=max(0,self.skip-1);return
        if self.skip:return
        if tag in {'p','div','table','tr','td','th'}:self.flush()
        if tag in {'td','th'}:
            require(self.cell is not None and self.row is not None,'RTF_TABLE_STRUCTURE')
            self.count+=1;require(self.count<=100000,'CELL_LIMIT')
            self.row.append(checked_text(''.join(self.cell).strip()));self.cell=None
        elif tag=='tr':
            require(self.row is not None and self.cell is None,'RTF_TABLE_STRUCTURE')
            self.table.append(self.row);self.row=None
        elif tag=='table':
            require(self.table is not None and self.row is None,'RTF_TABLE_STRUCTURE')
            self.tables.append({'locator':f'table:{len(self.tables)+1}','rows':self.table});self.table=None

    def handle_data(self,data):
        if self.skip:return
        self.parts.append(data)
        if self.cell is not None:self.cell.append(data)


class SpreadsheetHtml(HTMLParser):
    """Read HTML exports named .xls as inert, located text.

    Legacy exports may contain malformed/nested layout tables. Do not invent
    spreadsheet coordinates or numeric types from their visual arrangement.
    """
    boundaries = {'p','div','br','table','tr','td','th','li','h1','h2','h3','h4','h5','h6'}
    ignored = {'head','script','style','template','noscript','noframes'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts=[];self.blocks=[];self.suppressed=[];self.size=0;self.nodes=0
        self.dependencies=False

    def flush(self):
        text=checked_text(''.join(self.parts)).strip();self.parts=[]
        if text:self.blocks.append(text)
        require(len(self.blocks)<=100000,'CELL_LIMIT')

    def handle_starttag(self,tag,attrs):
        self.nodes+=1;require(self.nodes<=300000,'CELL_LIMIT')
        if tag in {'frame','iframe','object','embed'}:self.dependencies=True
        if self.suppressed:
            if tag in self.ignored:self.suppressed.append(tag)
            return
        if tag in self.ignored:self.flush();self.suppressed.append(tag);return
        if tag in self.boundaries:self.flush()

    def handle_endtag(self,tag):
        if self.suppressed:
            if tag==self.suppressed[-1]:self.suppressed.pop()
            return
        if tag in self.boundaries:self.flush()

    def handle_data(self,data):
        if self.suppressed:return
        self.size+=len(data.encode());require(self.size<=MAX_TEXT,'TEXT_TOO_LARGE')
        self.parts.append(data)


def html_spreadsheet(source):
    raw=source.read_bytes()
    if not re.match(br'\s*(?:\xef\xbb\xbf)?\s*(?:<!doctype\s+html\b|<html\b|<table\b)',raw,re.I):
        return None
    warnings=[{'code':'HTML_XLS_TEXT_ONLY_TABLE_STRUCTURE_AND_NUMERIC_TYPES_UNVERIFIED'}]
    try:text=raw.decode('utf-8-sig')
    except UnicodeError:
        text=raw.decode('cp1252');warnings.append({'code':'ASSUMED_WINDOWS_1252_ENCODING'})
    parser=SpreadsheetHtml();parser.feed(text);parser.close();parser.flush()
    require(parser.blocks,'HTML_EXTERNAL_DEPENDENCIES_UNAVAILABLE' if parser.dependencies else 'EMPTY_TEXT')
    if parser.dependencies:warnings.append({'code':'HTML_EXTERNAL_DEPENDENCIES_NOT_FETCHED'})
    return parser.blocks,warnings


def extract(source, suffix, ocr_languages="spa+cat+eng", run=command):
    require(suffix in FORMATS and source.stat().st_size <= base.MAX_INPUT,"FORMAT_OR_SIZE_REJECTED")
    require(re.fullmatch(r"[a-z]{3}(?:\+[a-z]{3}){0,3}",ocr_languages),"INVALID_OCR_LANGUAGES")
    segments, tables, warnings = [], [], []
    text_bytes = 0

    def append(locator, content):
        nonlocal text_bytes
        content = checked_text(content).strip()
        checked_text(locator)
        if content:
            segments.append({"locator":locator,"content":content})
            text_bytes += len(content.encode())
        require(text_bytes <= MAX_TEXT,"TEXT_TOO_LARGE")

    html = html_spreadsheet(source) if suffix == '.xls' else None
    if html is not None:
        blocks,html_warnings=html
        for number,text in enumerate(blocks,1):append(f'html:block:{number}',text)
        warnings.extend(html_warnings)
    elif suffix in IMAGE_FORMATS:
        image_dimensions(source,suffix)
        with tempfile.TemporaryDirectory(prefix='knowledge-image-') as temporary:
            output=Path(temporary)/'ocr'
            run(['/usr/bin/tesseract',str(source),str(output),'-l',ocr_languages,'--psm','3'],timeout=45)
            append('image:1',read_output(output.with_suffix('.txt')))
            warnings.append({'code':'OCR_TEXT_REQUIRES_VERIFICATION','locator':'image:1'})
            warnings.append({'code':'IMAGE_VISUAL_CONTENT_AND_TABLE_STRUCTURE_NOT_INTERPRETED','locator':'image:1'})
    elif suffix == ".pdf":
        with tempfile.TemporaryDirectory(prefix="knowledge-pdf-") as temporary:
            folder = Path(temporary)
            output = folder / "pages.txt"
            # Preserve form-feed page boundaries for exact source citations.
            run(["/usr/bin/pdftotext","-layout","-enc","UTF-8",str(source),str(output)])
            pages = read_output(output).split("\f")
            if pages and not pages[-1].strip():
                pages.pop()
            require(0 < len(pages) <= MAX_PAGES,"PDF_PAGE_LIMIT")
            ocr_count = 0
            for number, text in enumerate(pages,1):
                if not text.strip():
                    ocr_count += 1
                    require(ocr_count <= MAX_OCR_PAGES,"OCR_PAGE_LIMIT")
                    image = folder / "scan"
                    run(["/usr/bin/pdftoppm","-f",str(number),"-l",str(number),"-scale-to","2400","-singlefile","-png",str(source),str(image)])
                    require(image.with_suffix(".png").stat().st_size <= 32*1024*1024,"OCR_IMAGE_LIMIT")
                    recognized = folder / "ocr"
                    run(["/usr/bin/tesseract",str(image.with_suffix(".png")),str(recognized),"-l",ocr_languages,"--psm","3"],timeout=45)
                    text = read_output(recognized.with_suffix(".txt"))
                    warnings.append({"code":"OCR_TEXT_REQUIRES_VERIFICATION","locator":f"page:{number}"})
                if not text.strip():
                    warnings.append({"code":"PAGE_WITHOUT_READABLE_TEXT","locator":f"page:{number}"})
                append(f"page:{number}",text)
    elif suffix in {'.doc','.rtf'}:
        with tempfile.TemporaryDirectory(prefix='knowledge-legacy-text-') as temporary:
            output=Path(temporary)/'text'
            if suffix=='.doc':
                text=capture_text(['/usr/bin/catdoc','-w','-d','utf-8',str(source)],output)
                for number,line in enumerate(text.splitlines(),1):append(f'line:{number}',line)
                warnings.append({'code':'DOC_TEXT_LINES_NOT_RENDERED_PAGES_TABLES_NOT_STRUCTURED_IMAGE_AND_REVISION_COVERAGE_UNVERIFIED'})
            else:
                require(source.read_bytes().lstrip().startswith(b'{\\rtf'),'RTF_SIGNATURE_REQUIRED')
                html=capture_text(['/usr/bin/unrtf','--html','--quiet','--nopict',str(source)],output)
                parser=RtfHtml();parser.feed(html);parser.close();parser.flush()
                require(parser.table is None and parser.row is None and parser.cell is None,'RTF_TABLE_STRUCTURE')
                for number,text in enumerate(parser.blocks,1):append(f'block:{number}',text)
                tables.extend(parser.tables)
                warnings.append({'code':'RTF_BLOCKS_NOT_RENDERED_PAGES_IMAGES_AND_EMBEDDED_OBJECTS_OMITTED'})
    elif suffix == ".xls":
        try:
            import xlrd
        except ImportError:
            raise ValueError("XLS_READER_UNAVAILABLE") from None
        # The reader handles BIFF data only; it does not execute VBA or refresh
        # external links. Diagnostics may contain document data: discard them.
        with open('/dev/null','w') as diagnostics:
            try:
                book=xlrd.open_workbook(file_contents=source.read_bytes(),logfile=diagnostics,
                    on_demand=True,ragged_rows=True,ignore_workbook_corruption=False)
            except Exception:
                raise ValueError("XLS_INVALID_OR_ENCRYPTED") from None
            try:
                require(0 < book.nsheets <= 100,"SHEET_LIMIT")
                require(book.datemode in (0,1),"XLS_INVALID_DATE_MODE")
                count=0
                for index in range(book.nsheets):
                    sheet=book.sheet_by_index(index)
                    name=checked_text(sheet.name)
                    require(0 < len(name) <= 100,"INVALID_SHEET_NAME")
                    require(sheet.nrows <= 100000 and sheet.ncols <= 256,"CELL_LIMIT")
                    cells=[]
                    for row in range(sheet.nrows):
                        count+=sheet.row_len(row)
                        require(count <= 100000,"CELL_LIMIT")
                        for column in range(sheet.row_len(row)):
                            cell=sheet.cell(row,column)
                            if cell.ctype in (xlrd.XL_CELL_EMPTY,xlrd.XL_CELL_BLANK):
                                continue
                            address=xlrd.cellname(row,column)
                            if cell.ctype in (xlrd.XL_CELL_NUMBER,xlrd.XL_CELL_DATE):
                                require(math.isfinite(cell.value),"XLS_INVALID_NUMBER")
                                value=format(Decimal(str(cell.value)),'f')
                                # Dates retain their raw serial and workbook epoch;
                                # type 'd' prevents numeric insights treating them as money.
                                kind='d' if cell.ctype==xlrd.XL_CELL_DATE else 'n'
                            elif cell.ctype==xlrd.XL_CELL_BOOLEAN:
                                value,kind=str(int(cell.value)),'b'
                            elif cell.ctype==xlrd.XL_CELL_ERROR:
                                value,kind=xlrd.error_text_from_code.get(cell.value,'#UNKNOWN!'),'e'
                            else:
                                require(cell.ctype==xlrd.XL_CELL_TEXT,"XLS_INVALID_CELL_TYPE")
                                value,kind=checked_text(cell.value),'s'
                            cells.append({'cell':address,'value':value,'type':kind,'formula':None,
                                'formulaMetadataAvailable':False})
                            append(f"sheet:{name}!{address}",value)
                    tables.append({'locator':f'sheet:{name}','cells':cells,'dateMode':book.datemode,
                        'formulaMetadataAvailable':False})
                    book.unload_sheet(index)
            finally:
                book.release_resources()
        warnings.append({'code':'XLS_SAVED_VALUES_ONLY_FORMULAS_UNAVAILABLE_NOT_RECALCULATED_DATES_ARE_SERIALS'})
        warnings.append({'code':'XLS_MACROS_IMAGES_CHARTS_COMMENTS_AND_EMBEDDED_OBJECTS_NOT_EXTRACTED'})
    elif suffix in {".docx",".xlsx"}:
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            require(len(infos) <= 5000 and sum(i.file_size for i in infos) <= 64*1024*1024 and
                    len({i.filename for i in infos}) == len(infos),"ARCHIVE_LIMIT")
            if suffix == ".docx":
                ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
                root = base.xml(archive,"word/document.xml")
                for number, paragraph in enumerate(root.iter(ns+"p"),1):
                    text = "".join((n.text or "") if n.tag == ns+"t" else
                                   "\t" if n.tag == ns+"tab" else "\n" if n.tag in {ns+"br",ns+"cr"} else ""
                                   for n in paragraph.iter())
                    append(f"paragraph:{number}",text)
                for number, table in enumerate(root.iter(ns+"tbl"),1):
                    rows = [["\n".join("".join(n.text or "" for n in p.iter(ns+"t")) for p in cell.iter(ns+"p"))
                             for cell in row.findall(ns+"tc")] for row in table.findall(ns+"tr")]
                    tables.append({"locator":f"table:{number}","rows":rows})
                warnings.append({"code":"DOCX_LOCATORS_ARE_PARAGRAPHS_NOT_RENDERED_PAGES"})
            else:
                ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                relns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
                workbook = base.xml(archive,"xl/workbook.xml")
                relationships = base.xml(archive,"xl/_rels/workbook.xml.rels")
                targets = {}
                for rel in relationships:
                    if rel.get("TargetMode") == "External":
                        continue
                    target = rel.get("Target","")
                    if target.startswith("/xl/"):
                        target = target[4:]
                    if re.fullmatch(r"worksheets/[A-Za-z0-9_.-]+\.xml",target):
                        targets[rel.get("Id")] = "xl/"+target
                strings = []
                if "xl/sharedStrings.xml" in archive.namelist():
                    strings = ["".join(n.text or "" for n in item.iter(ns+"t")) for item in base.xml(archive,"xl/sharedStrings.xml").iter(ns+"si")]
                sheets = list(workbook.iter(ns+"sheet"))
                require(0 < len(sheets) <= 100,"SHEET_LIMIT")
                count = 0
                for sheet in sheets:
                    name = checked_text(sheet.get("name",""))
                    require(0 < len(name) <= 100,"INVALID_SHEET_NAME")
                    target = targets.get(sheet.get(relns+"id"))
                    require(target is not None,"INVALID_SHEET_TARGET")
                    cells, seen = [], set()
                    for cell in base.xml(archive,target).iter(ns+"c"):
                        count += 1
                        require(count <= 100000,"CELL_LIMIT")
                        address = cell.get("r","")
                        require(re.fullmatch(r"[A-Z]{1,3}[1-9][0-9]{0,6}",address) and address not in seen,"INVALID_CELL_ADDRESS")
                        seen.add(address)
                        kind, value = cell.get("t","n"), cell.findtext(ns+"v","")
                        if kind == "s":
                            require(value.isdigit() and int(value) < len(strings),"INVALID_SHARED_STRING")
                            value = strings[int(value)]
                        elif kind == "inlineStr":
                            value = "".join(n.text or "" for n in cell.iter(ns+"t"))
                        formula = cell.findtext(ns+"f")
                        checked_text(value)
                        if formula is not None:
                            checked_text(formula)
                        cells.append({"cell":address,"value":value,"type":kind,"formula":formula,"style":cell.get("s")})
                        append(f"sheet:{name}!{address}",value)
                    tables.append({"locator":f"sheet:{name}","cells":cells})
                warnings.append({"code":"XLSX_SAVED_VALUES_ONLY_FORMULAS_NOT_RECALCULATED_DATES_MAY_BE_SERIALS"})
    else:
        raw = source.read_bytes()
        require(len(raw)<=MAX_TEXT,"TEXT_TOO_LARGE")
        encoding="utf-8-sig"
        if raw.startswith((b"\xff\xfe\x00\x00",b"\x00\x00\xfe\xff")):
            encoding="utf-32"
        elif raw.startswith((b"\xff\xfe",b"\xfe\xff")):
            encoding="utf-16"
        elif suffix!='.json' and len(raw)>=4 and len(raw)%2==0:
            # Some Windows CSV exports omit the BOM. Accept only the narrow,
            # unambiguous zero-high-byte layout (U+0001..U+00FF), not arbitrary
            # binary data guessed to be Unicode. Other layouts remain rejected.
            low,high=raw[::2],raw[1::2]
            if high.count(0)==len(high) and 0 not in low:
                encoding='utf-16-le'
            elif low.count(0)==len(low) and 0 not in high:
                encoding='utf-16-be'
            if encoding.startswith('utf-16-'):
                warnings.append({'code':'ASSUMED_'+encoding.upper().replace('-','_')+'_WITHOUT_BOM_ENCODING'})
        try:
            text=raw.decode(encoding)
        except UnicodeError:
            require(suffix!=".json","JSON_ENCODING_UNSUPPORTED")
            text=raw.decode("cp1252")
            warnings.append({"code":"ASSUMED_WINDOWS_1252_ENCODING"})
        text=checked_text(text)
        require(text.strip(),"EMPTY_TEXT")
        if suffix == ".csv":
            try:
                dialect=csv.Sniffer().sniff(text[:8192],delimiters=",;\t|")
                rows=list(csv.reader(io.StringIO(text),dialect))
            except csv.Error:
                # Sniffer rejects common exports with a trailing field absent
                # from the header. Prefer a uniquely evidenced separator over
                # splitting decimal commas into invented columns.
                candidates=[]
                for delimiter in ',;\t|':
                    sample=list(csv.reader(io.StringIO(text),delimiter=delimiter))
                    nonempty=[row for row in sample if row]
                    if len(nonempty)>=2 and all(len(row)>1 for row in nonempty):
                        require(len(sample)<=100000 and sum(map(len,sample))<=100000,'CELL_LIMIT')
                        candidates.append((delimiter,sample))
                if len(candidates)==1:
                    delimiter,rows=candidates[0]
                    warnings.append({'code':'CSV_DELIMITER_INFERRED_FROM_ROWS','delimiter':delimiter})
                else:
                    rows=list(csv.reader(io.StringIO(text),csv.excel))
                    warnings.append({'code':'CSV_DELIMITER_NOT_CONFIRMED'})
            require(len(rows) <= 100000 and sum(len(row) for row in rows) <= 100000,"CELL_LIMIT")
            if len({len(row) for row in rows if row})>1:
                warnings.append({'code':'CSV_RAGGED_ROWS'})
            tables.append({"locator":"csv","rows":rows})
            for number,row in enumerate(rows,1):
                append(f"row:{number}"," | ".join(row))
        else:
            for number,line in enumerate(text.splitlines(),1):
                append(f"line:{number}",line)
    require(segments,"EMPTY_TEXT")
    # Tables can repeat text; cap the complete structured response too.
    result = {"ok":True,"segments":segments,"tables":tables,"warnings":warnings}
    encoded = json.dumps(result,ensure_ascii=False)
    require(len(encoded.encode()) <= 8*1024*1024,"EXTRACTION_OUTPUT_LIMIT")
    require(not base.SECRET.search(encoded),"CREDENTIAL_SHAPED_CONTENT")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format",required=True,choices=sorted(FORMATS))
    parser.add_argument("--ocr-languages",default="spa+cat+eng")
    args = parser.parse_args()
    resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,)*2)
    resource.setrlimit(resource.RLIMIT_CPU,(120,120))
    resource.setrlimit(resource.RLIMIT_FSIZE,(32*1024*1024,)*2)
    resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
    try:
        result = extract(Path("/input"),args.format,args.ocr_languages)
    except UnicodeError:
        result={"ok":False,"reason":"TEXT_ENCODING_UNAVAILABLE"}
    except Exception as error:
        reason=str(error) if isinstance(error,ValueError) else "PARSER_TIMEOUT" if isinstance(error,subprocess.TimeoutExpired) else "PARSER_PROCESS_FAILED"
        result = {"ok":False,"reason":reason if re.fullmatch(r"[A-Z_]{1,80}",reason) else "PARSER_FAILED"}
    print(json.dumps(result,ensure_ascii=False))


if __name__ == "__main__":
    main()
