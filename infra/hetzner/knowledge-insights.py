#!/usr/bin/env python3
"""Reproducible decimal calculations over explicitly selected source cells."""
from decimal import Decimal, localcontext
import re


def require(value,code):
    if not value:
        raise ValueError(code)


def number(value,locale):
    require(isinstance(value,str) and len(value)<=64,"INVALID_NUMERIC_VALUE")
    value=value.strip()
    require(locale in {"canonical","es","en"},"INVALID_NUMBER_LOCALE")
    if locale=='canonical':
        pattern=r"[+-]?[0-9]{1,30}(?:\.[0-9]{1,10})?"
    elif locale=='es':
        pattern=r"[+-]?(?:[0-9]{1,30}|[0-9]{1,3}(?:\.[0-9]{3}){1,9})(?:,[0-9]{1,10})?"
    else:
        pattern=r"[+-]?(?:[0-9]{1,30}|[0-9]{1,3}(?:,[0-9]{3}){1,9})(?:\.[0-9]{1,10})?"
    require(re.fullmatch(pattern,value),"AMBIGUOUS_OR_NON_NUMERIC_CELL")
    if locale=='es':
        value=value.replace('.','').replace(',','.')
    elif locale=='en':
        value=value.replace(',','')
    return Decimal(value)


def calculate(store,source,sha256,table_index,selection,operation,locale="canonical"):
    require(type(table_index) is int and table_index>=0 and operation in {"sum","count","min","max","mean"},"INVALID_CALCULATION")
    payload=store.structured_document(source,sha256)
    require(table_index<len(payload["tables"]),"TABLE_UNAVAILABLE")
    table=payload["tables"][table_index]
    require(isinstance(selection,dict),"EXPLICIT_SELECTION_REQUIRED")
    values,locators,formula_cells=[],[],[]
    if "cells" in table:
        require(set(selection)=={"cells"} and isinstance(selection["cells"],list) and 0<len(selection["cells"])<=10000,
                "INVALID_CELL_SELECTION")
        require(all(isinstance(c,str) for c in selection["cells"]) and len(set(selection["cells"]))==len(selection["cells"]),"DUPLICATE_CELL_SELECTION")
        cells={cell["cell"]:cell for cell in table["cells"]}
        for address in selection["cells"]:
            require(address in cells,"CELL_UNAVAILABLE")
            cell=cells[address]
            # Numeric Excel cells use XML's canonical decimal syntax. Styling
            # may represent a date; callers must choose a meaningful measure.
            require(cell["type"]=='n',"NON_NUMERIC_XLSX_CELL")
            values.append(number(cell["value"],"canonical"))
            locators.append(table["locator"]+"!"+address)
            if cell.get("formula") is not None:
                formula_cells.append(address)
    else:
        require("rows" in table and set(selection)=={"rows","column"} and isinstance(selection["rows"],list) and
                0<len(selection["rows"])<=10000 and type(selection["column"]) is int and selection["column"]>=1,"INVALID_ROW_SELECTION")
        require(all(type(row) is int and row>=1 for row in selection["rows"]) and len(set(selection["rows"]))==len(selection["rows"]),"DUPLICATE_ROW_SELECTION")
        for row in selection["rows"]:
            require(row<=len(table["rows"]) and selection["column"]<=len(table["rows"][row-1]),"CELL_UNAVAILABLE")
            values.append(number(table["rows"][row-1][selection["column"]-1],locale))
            locators.append(f"{table['locator']}:row:{row}:column:{selection['column']}")
    with localcontext() as context:
        context.prec=80
        result={"sum":lambda:sum(values,Decimal(0)),"count":lambda:Decimal(len(values)),
                "min":lambda:min(values),"max":lambda:max(values),"mean":lambda:sum(values,Decimal(0))/len(values)}[operation]()
    return {"operation":operation,"result":format(result,'f'),"selectedCells":len(values),"source":source,"sha256":sha256,
            "tableIndex":table_index,"selection":selection,"numberLocale":locale,"decimalPrecision":80,
            "citations":locators,"cachedFormulaCells":formula_cells,
            "warnings":["Only explicitly selected cells are included; units and business meaning are not inferred."]+
                       (["Formula results are saved source values and have not been recalculated."] if formula_cells else []),
            "sourceWarnings":payload.get("warnings",[])}
