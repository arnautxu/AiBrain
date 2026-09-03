"use client";

import { useEffect, useState } from "react";
import { isSpreadsheetPreview, type SpreadsheetPreview } from "@/documents/spreadsheet-preview";

export function SpreadsheetTable({ preview }: { preview: SpreadsheetPreview }) {
  const [selected, setSelected] = useState(0);
  const [rowPage, setRowPage] = useState(0);
  const [columnPage, setColumnPage] = useState(0);
  const sheet = preview.sheets[selected] ?? preview.sheets[0];
  const rows = [...new Set(sheet.cells.map((cell) => Number(cell.address.replace(/^[A-Z]+/, ""))))].sort((a, b) => a - b);
  const columns = [...new Set(sheet.cells.map((cell) => cell.address.replace(/\d+$/, "")))].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const values = new Map(sheet.cells.map((cell) => [cell.address, cell.value]));
  const visibleRows = rows.slice(rowPage * 50, (rowPage + 1) * 50);
  const visibleColumns = columns.slice(columnPage * 12, (columnPage + 1) * 12);
  const button = "touch-target min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-40";
  return <div className="flex h-full min-h-0 flex-col bg-[var(--surface)] text-[var(--text)]">
    <div className="shrink-0 space-y-3 border-b border-[var(--border)] p-4">
      <label className="flex items-center gap-3 text-sm font-medium">Hoja
        <select aria-label="Hoja del libro" className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-base" value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setRowPage(0); setColumnPage(0); }}>
          {preview.sheets.map((item, index) => <option key={index} value={index}>{item.name}{item.hidden ? " (oculta en el original)" : ""}</option>)}
        </select>
      </label>
      <p className="text-sm leading-5 text-[var(--text-secondary)]">Solo lectura · macros desactivadas. Valores guardados, sin recalcular fórmulas. Se muestran filas y columnas con datos; no el diseño de impresión original.</p>
      {preview.truncated ? <p role="status" className="text-sm font-medium">Vista parcial por tamaño. Pide en el chat la lectura de las partes restantes antes de sacar conclusiones.</p> : null}
    </div>
    <div tabIndex={0} aria-label={`Celdas de ${sheet.name}`} className="scrollbar-thin min-h-0 flex-1 overflow-auto">
      {rows.length ? <table className="w-full border-collapse text-left text-sm tabular-nums">
        <caption className="sr-only">{sheet.name}: valores guardados por dirección de celda</caption>
        <thead className="sticky top-0 bg-[var(--surface-muted)]"><tr><th scope="col" className="border-b border-[var(--border)] p-3">Fila</th>{visibleColumns.map((column) => <th key={column} scope="col" className="border-b border-[var(--border)] p-3">{column}</th>)}</tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={row} className="hover:bg-[var(--surface-hover)]"><th scope="row" className="border-b border-[var(--border-subtle)] bg-[var(--surface-muted)] p-3 font-medium">{row}</th>{visibleColumns.map((column) => <td key={column} title={`${column}${row}`} className="min-w-28 max-w-80 whitespace-pre-wrap break-words border-b border-[var(--border-subtle)] p-3 align-top">{values.get(`${column}${row}`) ?? ""}</td>)}</tr>)}</tbody>
      </table> : <p className="p-6 text-sm">No hay celdas con valores en esta vista.{preview.truncated ? " La extracción es parcial." : ""}</p>}
    </div>
    {rows.length > 50 || columns.length > 12 ? <nav aria-label="Páginas de celdas" className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border)] p-3">
      {rows.length > 50 ? <><button className={button} disabled={rowPage === 0} onClick={() => setRowPage(rowPage - 1)}>Filas anteriores</button><span className="text-sm">{rowPage + 1} / {Math.ceil(rows.length / 50)}</span><button className={button} disabled={(rowPage + 1) * 50 >= rows.length} onClick={() => setRowPage(rowPage + 1)}>Más filas</button></> : null}
      {columns.length > 12 ? <><button className={button} disabled={columnPage === 0} onClick={() => setColumnPage(columnPage - 1)}>Columnas anteriores</button><button className={button} disabled={(columnPage + 1) * 12 >= columns.length} onClick={() => setColumnPage(columnPage + 1)}>Más columnas</button></> : null}
    </nav> : null}
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
        if (!previewUrl.startsWith("/api/projects/")) throw new Error("Private preview required");
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
