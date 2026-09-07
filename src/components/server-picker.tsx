"use client";

import { useEffect, useState } from "react";
import { Folder, File, ArrowClockwise, X } from "@phosphor-icons/react";
import { useModalFocus } from "@/ui/use-modal-focus";
import { isServerReference, serverDirectoryQuery, type ServerReference } from "@/documents/server-reference-contract";

type Page = { results: ServerReference[]; checkedAt: string; nextQuery: string | null; limited: boolean };
export function ServerPicker({ projectId, selected, onSelect, onClose }: {
  projectId: string; selected: ServerReference[]; onSelect: (items: ServerReference[]) => void; onClose: () => void;
}) {
  const focus = useModalFocus<HTMLDivElement>(true, onClose);
  const [query, setQuery] = useState("server:/");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState(selected);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/server-files?${new URLSearchParams({ projectId, query })}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.available || data.sourceChecked !== true) throw new Error(data.warning || "No se ha podido consultar Windows.");
        if (!Array.isArray(data.results)) throw new Error("Listado no válido.");
        const results = data.results.map((item: Record<string, unknown>) => ({ path: item.path, name: item.name, kind: item.kind, modifiedAt: item.modifiedAt, size: item.size }));
        if (!results.every(isServerReference)) throw new Error("Listado no válido.");
        if (!controller.signal.aborted) setPage({ results, checkedAt: data.checkedAt, nextQuery: data.nextQuery, limited: data.limited });
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Servidor no disponible."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [projectId, query, revision]);
  const location = query.split("?")[0];
  function navigate(next: string) {
    setBusy(true); setError(null); setPage(null); setQuery(next); setRevision(value => value + 1);
  }
  function toggle(item: ServerReference) {
    setSelection(current => current.some(ref => ref.path === item.path) ? current.filter(ref => ref.path !== item.path) : current.length < 5 ? [...current, item] : current);
  }
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-3" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={focus} role="dialog" aria-modal="true" aria-label="Server" className="flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-[var(--text)] shadow-xl">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Server</h2><button type="button" aria-label="Cerrar Server" className="touch-target rounded p-2" onClick={onClose}><X size={20}/></button></div>
      <p className="mb-3 text-xs text-[var(--text-muted)]">Archivos del servidor Windows. Selecciona hasta 5 referencias para trabajar en el chat. Los originales son de sólo lectura.</p>
      <div className="mb-3 flex items-center gap-2">
        <button type="button" className="touch-target rounded-lg border border-[var(--border)] px-3 py-2 text-sm" disabled={busy || location === "server:/"} onClick={() => navigate(location.replace(/\/$/, "").split("/").slice(0, -1).join("/").replace(/^server:$/, "server:/"))}>Subir</button>
        <span className="min-w-0 flex-1 truncate text-sm" title={location}>{location === "server:/" ? "Unidades" : location.replace("server:/", "")}</span>
        <button type="button" aria-label="Actualizar desde Windows" disabled={busy} className="touch-target rounded-lg border border-[var(--border)] p-2" onClick={() => { navigate(location); }}><ArrowClockwise size={19}/></button>
      </div>
      <div className="min-h-40 overflow-y-auto" aria-busy={busy}>
        {busy ? <p role="status" className="p-5 text-sm">Consultando Windows… Puede tardar más de un minuto.</p> : null}
        {error ? <p role="alert" className="p-4 text-sm">{error} Usa Actualizar para reintentarlo. No se muestra una copia antigua.</p> : null}
        {page ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{page.results.map(item => <div key={item.path} className="min-w-0 rounded-xl border border-[var(--border)] p-3">
          <button type="button" className="flex w-full flex-col items-center gap-2 rounded-lg py-3 text-sm hover:bg-[var(--surface-hover)]" aria-label={item.kind === "directory" ? `Abrir ${item.name}` : `Seleccionar ${item.name}`} onClick={() => item.kind === "directory" ? navigate(serverDirectoryQuery(item.path)) : toggle(item)}>
            {item.kind === "directory" ? <Folder size={38} weight="fill" className="text-sky-500"/> : <File size={34}/>}
            <span className="w-full truncate" title={item.name}>{item.name}</span>
          </button>
          <label className="flex cursor-pointer items-center gap-2 text-xs"><input type="checkbox" aria-label={`Adjuntar ${item.name}`} checked={selection.some(ref => ref.path === item.path)} disabled={selection.length >= 5 && !selection.some(ref => ref.path === item.path)} onChange={() => toggle(item)}/>Seleccionar</label>
        </div>)}</div> : null}
        {page && !page.results.length ? <p className="p-4 text-sm">Sin elementos visibles en esta ubicación.</p> : null}
      </div>
      {page ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]"><span>Consultado: {new Date(page.checkedAt).toLocaleTimeString()}{page.limited ? " · listado parcial" : ""}</span>{page.nextQuery ? <button type="button" className="touch-target rounded border px-3 py-2" onClick={() => navigate(page.nextQuery!)}>Siguiente página</button> : null}</div> : null}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3"><span className="text-xs">{selection.length} seleccionadas · las carpetas no se cargan completas</span><button type="button" disabled={!selection.length} className="touch-target rounded-xl bg-[var(--send-button)] px-4 py-2 text-sm text-[var(--send-button-text)] disabled:opacity-40" onClick={() => { onSelect(selection); onClose(); }}>Adjuntar referencias</button></div>
    </div>
  </div>;
}
