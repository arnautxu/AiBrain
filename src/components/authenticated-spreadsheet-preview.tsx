"use client";

import { useEffect, useState } from "react";
import { isSpreadsheetPreview, type SpreadsheetPreview } from "@/documents/spreadsheet-preview";

export function SpreadsheetTable({ preview }: { preview: SpreadsheetPreview }) {
  const [selected, setSelected] = useState(() => Math.max(0, preview.sheets.findIndex((sheet) => !sheet.hidden && sheet.cells.length > 0)));
  const [rowPage, setRowPage] = useState(0);
  const [columnPage, setColumnPage] = useState(0);
  const [activeCell, setActiveCell] = useState<string | null>(null);
  const sheet = preview.sheets[selected] ?? preview.sheets[0];
  const populatedRows = sheet.cells.map((cell) => Number(cell.address.replace(/^[A-Z]+/, "")));
  const populatedColumns = sheet.cells.map((cell) => cell.address.replace(/\d+$/, ""));
  const columnIndex = (name: string) => [...name].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  const columnName = (index: number) => {
    let result = "";
    for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
    return result;
  };
  const rows = sheet.cells.length ? Array.from({ length: Math.max(...populatedRows) }, (_, index) => index + 1) : [];
  const columns = sheet.cells.length ? Array.from({ length: Math.max(...populatedColumns.map(columnIndex)) }, (_, index) => columnName(index + 1)) : [];
  const values = new Map(sheet.cells.map((cell) => [cell.address, cell.value]));
  const visibleRows = rows.slice(rowPage * 50, (rowPage + 1) * 50);
  const visibleColumns = columns.slice(columnPage * 12, (columnPage + 1) * 12);
  const button = "touch-target min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-40";
  const activeValue = activeCell ? values.get(activeCell) ?? "" : "Selecciona una celda";
  const selectSheet = (index: number) => { setSelected(index); setRowPage(0); setColumnPage(0); setActiveCell(null); };
  return <div className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[#f6f8f7] text-[#17201b] shadow-[var(--shadow-sm)]">
    <div className="shrink-0 bg-[#176b46] px-4 py-2.5 text-white">
      <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-[12px] font-semibold">Libro de trabajo</p><p className="text-[10px] text-white/70">Vista protegida · solo lectura</p></div><span className="rounded-full bg-white/12 px-2.5 py-1 text-[10px] font-medium">Guardado</span></div>
    </div>
    <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-[#cbd6cf] bg-white px-2 py-1.5">
      <label className="flex min-w-0 shrink items-center gap-1.5 text-[10px] font-medium text-[#536158]">
        <span className="hidden sm:inline">Hoja</span>
        <select aria-label="Hoja del libro" className="h-7 min-w-0 max-w-36 rounded border border-[#cbd6cf] bg-white px-1.5 text-[11px] font-medium text-[#17201b] outline-none focus-visible:ring-2 focus-visible:ring-[#18864b]" value={selected} onChange={(event) => selectSheet(Number(event.target.value))}>
          {preview.sheets.map((item, index) => <option key={index} value={index}>{item.name}{item.hidden ? " (oculta en el original)" : ""}</option>)}
        </select>
      </label>
      <div className="grid h-7 w-14 shrink-0 place-items-center rounded border border-[#cbd6cf] bg-[#f5f7f5] text-[11px] font-semibold">{activeCell ?? "A1"}</div>
      <div className="min-w-0 flex-1 truncate rounded border border-[#cbd6cf] bg-white px-2 py-1 text-[11px]" aria-live="polite">{activeValue}</div>
    </div>
    {preview.truncated ? <p role="status" className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900">Vista parcial por tamaño. Confirma el resto antes de sacar conclusiones.</p> : null}
    <div tabIndex={0} aria-label={`Celdas de ${sheet.name}`} className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-white">
      {rows.length ? <table className="w-full border-separate border-spacing-0 text-left text-[12px] tabular-nums">
        <caption className="sr-only">{sheet.name}: valores guardados por dirección de celda</caption>
        <thead className="sticky top-0 z-10 bg-[#edf1ee]"><tr><th scope="col" className="sticky left-0 z-20 h-7 w-10 border-b border-r border-[#cbd6cf] bg-[#e4eae6]" aria-label="Esquina de la hoja" />{visibleColumns.map((column) => <th key={column} scope="col" className="min-w-28 border-b border-r border-[#cbd6cf] px-2 py-1 text-center font-semibold text-[#4d5b52]">{column}</th>)}</tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={row}><th scope="row" className="sticky left-0 z-[5] w-10 border-b border-r border-[#cbd6cf] bg-[#edf1ee] px-2 py-1.5 text-center font-medium text-[#66736b]">{row}</th>{visibleColumns.map((column) => {
          const address = `${column}${row}`;
          const active = address === activeCell;
          return <td key={column} title={address} onClick={() => setActiveCell(address)} className={`h-8 min-w-28 max-w-80 cursor-cell whitespace-pre-wrap break-words border-b border-r px-2 py-1.5 align-top outline-none ${active ? "relative border-[#18864b] bg-[#eaf6ef] ring-2 ring-inset ring-[#18864b]" : "border-[#dce3de] bg-white hover:bg-[#f4faf6]"}`}>{values.get(address) ?? ""}</td>;
        })}</tr>)}</tbody>
      </table> : <p className="p-6 text-sm">No hay celdas con valores en esta vista.{preview.truncated ? " La extracción es parcial." : ""}</p>}
    </div>
    {rows.length > 50 || columns.length > 12 ? <nav aria-label="Páginas de celdas" className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[#cbd6cf] bg-white p-2">
      {rows.length > 50 ? <><button className={button} disabled={rowPage === 0} onClick={() => setRowPage(rowPage - 1)}>Filas anteriores</button><span className="text-sm">{rowPage + 1} / {Math.ceil(rows.length / 50)}</span><button className={button} disabled={(rowPage + 1) * 50 >= rows.length} onClick={() => setRowPage(rowPage + 1)}>Más filas</button></> : null}
      {columns.length > 12 ? <><button className={button} disabled={columnPage === 0} onClick={() => setColumnPage(columnPage - 1)}>Columnas anteriores</button><button className={button} disabled={(columnPage + 1) * 12 >= columns.length} onClick={() => setColumnPage(columnPage + 1)}>Más columnas</button></> : null}
    </nav> : null}
    <div className="scrollbar-thin flex shrink-0 items-end gap-1 overflow-x-auto border-t border-[#cbd6cf] bg-[#edf1ee] px-2 pt-1">
      {preview.sheets.map((item, index) => <button key={index} type="button" onClick={() => selectSheet(index)} className={`touch-target min-h-9 shrink-0 border-b-2 px-3 text-[11px] font-medium ${selected === index ? "border-[#176b46] bg-white text-[#176b46]" : "border-transparent text-[#536158] hover:bg-white/70"}`}>{item.name}{item.hidden ? " · oculta" : ""}</button>)}
      <span className="ml-auto shrink-0 px-2 pb-2 text-[10px] text-[#66736b]">Macros desactivadas · valores guardados</span>
    </div>
  </div>;
}

export function AuthenticatedSpreadsheetPreview({ previewUrl }: { previewUrl: string }) {
  const [retry, setRetry] = useState(0);
  const source = `${previewUrl}:${retry}`;
  const [state, setState] = useState<{ source: string; preview?: SpreadsheetPreview; error?: boolean }>({ source });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        if (!previewUrl.startsWith("/api/projects/") && !previewUrl.startsWith("/api/threads/")) throw new Error("Private preview required");
        const response = await fetch(previewUrl, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json") || !response.body) throw new Error("Preview unavailable");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 100_000) throw new Error("Preview too large");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const preview: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!isSpreadsheetPreview(preview)) throw new Error("Invalid preview");
        if (!controller.signal.aborted) setState({ source, preview });
      } catch { if (!controller.signal.aborted) setState({ source, error: true }); }
    })();
    return () => controller.abort();
  }, [previewUrl, source]);
  if (state.source !== source || (!state.preview && !state.error)) return <p className="p-6 text-sm" role="status">Cargando hojas del libro…</p>;
  if (state.error) return <div role="alert" className="space-y-3 p-6 text-sm"><p>No se ha podido cargar la vista previa del libro.</p><button className="touch-target min-h-11 rounded-lg border border-[var(--border)] px-4 hover:bg-[var(--surface-hover)]" onClick={() => setRetry(retry + 1)}>Reintentar</button></div>;
  return <SpreadsheetTable key={source} preview={state.preview!} />;
}
