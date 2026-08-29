"use client";

import NextImage from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowSquareOut,
  Browser,
  ChartLineUp,
  File,
  FileText,
  GlobeHemisphereWest,
  ImagesSquare,
  MagnifyingGlass,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import {
  advancedArtifactLibraryItem,
  buildLibraryItems,
  isLibraryItem,
  type LibraryItem,
  type LibraryItemType,
} from "@/library/contracts";
import { isAdvancedArtifactSummary, type AdvancedArtifactKind } from "@/artifacts/contracts";
import type { WorkbenchProject, WorkbenchThread } from "@/workbench/types";
import { useModalFocus } from "@/ui/use-modal-focus";
import { SafeVisualizationPreview } from "@/components/safe-visualization-preview";
import { AuthenticatedPdfPreview } from "@/components/authenticated-pdf-preview";

type LibraryFilter = "all" | LibraryItemType;

const filterCopy: Array<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "Todo" },
  { id: "upload", label: "Subidos" },
  { id: "document", label: "Documentos" },
  { id: "image", label: "Imágenes" },
  { id: "result", label: "Resultados" },
  { id: "browser", label: "Navegador" },
  { id: "visualization", label: "Visualizaciones" },
  { id: "internal-site", label: "Sitios internos" },
];

function icon(type: LibraryItemType) {
  if (type === "image") return <ImagesSquare size={17} />;
  if (type === "result") return <FileText size={17} />;
  if (type === "browser") return <Browser size={17} />;
  if (type === "visualization") return <ChartLineUp size={17} />;
  if (type === "internal-site") return <GlobeHemisphereWest size={17} />;
  return <File size={17} />;
}

function formatSize(size: number | null) {
  if (size === null) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function label(type: LibraryItemType) {
  return {
    upload: "Archivo subido",
    document: "Documento generado",
    image: "Imagen generada",
    result: "Respuesta descargable",
    browser: "Resultado del navegador",
    visualization: "Visualización segura",
    "internal-site": "Sitio interno",
  }[type];
}

function responseItems(value: unknown): LibraryItem[] | null {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items) ||
      !value.items.every(isLibraryItem)) return null;
  return value.items;
}

export function LibraryPanel({
  open,
  projects,
  threads,
  onClose,
  onOpenConversation,
}: {
  open: boolean;
  projects: WorkbenchProject[];
  threads: WorkbenchThread[];
  onClose: () => void;
  onOpenConversation: (threadId: string, messageId: string) => void;
}) {
  const fallbackItems = useMemo(() => buildLibraryItems({ projects, threads }), [projects, threads]);
  const [remoteItems, setRemoteItems] = useState<LibraryItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [offlineFallback, setOfflineFallback] = useState(false);
  const [artifactAction, setArtifactAction] = useState<AdvancedArtifactKind | "publish" | null>(null);
  const [artifactNotice, setArtifactNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalFocus(open, onClose, searchRef);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setLoading(true);
      return fetch("/api/library", { cache: "no-store", signal: controller.signal });
    })
      .then(async (response) => response.ok ? responseItems(await response.json()) : null)
      .then((result) => {
        if (!result) {
          setRemoteItems(null);
          setOfflineFallback(true);
          return;
        }
        setRemoteItems(result);
        setOfflineFallback(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRemoteItems(null);
          setOfflineFallback(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open]);

  const items = remoteItems ?? fallbackItems;

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    return items.filter((item) => (filter === "all" || item.type === filter) &&
      (!needle || `${item.name} ${item.projectName} ${item.threadTitle}`.toLocaleLowerCase("es").includes(needle)));
  }, [filter, items, query]);
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;

  const upsertAdvancedItem = (summary: unknown) => {
    if (!isAdvancedArtifactSummary(summary)) return null;
    const projectName = projects.find((project) => project.id === summary.projectId)?.name;
    const threadTitle = threads.find((thread) => thread.id === summary.threadId)?.title;
    if (!projectName || !threadTitle) return null;
    const item = advancedArtifactLibraryItem(summary, { projectName, threadTitle });
    setRemoteItems((current) => [item, ...(current ?? fallbackItems).filter((candidate) => candidate.id !== item.id)]);
    setFilter("all");
    setSelectedId(item.id);
    return item;
  };

  const createArtifact = async (kind: AdvancedArtifactKind) => {
    if (!selected || selected.type !== "result") return;
    setArtifactAction(kind);
    setArtifactNotice(null);
    try {
      const titleBase = selected.name.replace(/\.(?:md|txt)$/i, "");
      const response = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: kind === "visualization" ? `Visualización · ${titleBase}` : `Sitio interno · ${titleBase}`,
          threadId: selected.threadId,
          messageId: selected.messageId,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "No se ha podido crear el artefacto.";
        setArtifactNotice(message);
        return;
      }
      const summary = payload && typeof payload === "object" && "summary" in payload ? payload.summary : null;
      const item = upsertAdvancedItem(summary);
      setArtifactNotice(item ? (kind === "visualization" ? "Visualización creada desde los datos reales de la respuesta." : "Sitio interno creado. Puedes revisarlo antes de publicarlo.") : "Artefacto creado.");
    } catch {
      setArtifactNotice("No se ha podido conectar con el servicio de artefactos.");
    } finally {
      setArtifactAction(null);
    }
  };

  const publishArtifact = async () => {
    if (!selected?.artifactId) return;
    setArtifactAction("publish");
    setArtifactNotice(null);
    try {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(selected.artifactId)}/publish`, { method: "POST" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "No se ha podido publicar.";
        setArtifactNotice(message);
        return;
      }
      const summary = payload && typeof payload === "object" && "summary" in payload ? payload.summary : null;
      upsertAdvancedItem(summary);
      setArtifactNotice("Snapshot publicado como sitio interno. Sigue protegido por tu sesión de empresa.");
    } catch {
      setArtifactNotice("No se ha podido conectar con el servicio de publicación.");
    } finally {
      setArtifactAction(null);
    }
  };

  if (!open) return null;
  const previewIsImage = selected?.previewUrl && selected.mimeType?.startsWith("image/");
  const previewIsPdf = selected?.mimeType === "application/pdf";

  return (
    <div className="workspace-overlay fixed inset-0 z-[75] flex sm:p-5">
      <button aria-label="Cerrar biblioteca" className="absolute inset-0" onClick={onClose} />
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Biblioteca"
        className="workspace-panel panel-enter relative m-auto flex h-full w-full max-w-[1120px] flex-col overflow-hidden bg-[var(--surface-raised)] shadow-[var(--shadow-popover)] sm:h-[min(800px,calc(100dvh-2.5rem))] sm:rounded-[22px] sm:border sm:border-[var(--border-subtle)]"
      >
        <header className="workspace-panel-header flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="workspace-panel-title text-[var(--text)]">Biblioteca</h2>
            <p className="workspace-panel-subtitle mt-0.5 hidden sm:block">Archivos y resultados creados en tus conversaciones.</p>
          </div>
          <button aria-label="Cerrar biblioteca" className="grid size-10 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-0 w-full flex-col border-b border-[var(--border-subtle)] md:w-[48%] md:border-b-0 md:border-r">
            <div className="shrink-0 space-y-3 p-3 sm:p-4">
              <label className="flex h-11 items-center gap-2.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--text-subtle)] focus-within:border-[var(--border-strong)]">
                <MagnifyingGlass size={16} />
                <input ref={searchRef} aria-label="Buscar en la biblioteca" className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]" placeholder="Buscar archivos y resultados" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <div className="scrollbar-thin flex gap-1 overflow-x-auto pb-0.5" aria-label="Filtros de biblioteca">
                {filterCopy.map((option) => <button key={option.id} type="button" aria-pressed={filter === option.id} className={`min-h-8 shrink-0 rounded-full px-3 text-[11px] font-medium transition ${filter === option.id ? "bg-[var(--text)] text-[var(--surface)]" : "bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`} onClick={() => setFilter(option.id)}>{option.label}</button>)}
              </div>
              {offlineFallback ? <p className="text-[10px] text-[var(--text-subtle)]" role="status">Mostrando el historial ya cargado en este dispositivo.</p> : null}
            </div>

            <div role="listbox" aria-label="Elementos de la biblioteca" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3 sm:px-3">
              {loading && !items.length ? <div className="flex min-h-40 items-center justify-center gap-2 text-[12px] text-[var(--text-subtle)]"><SpinnerGap size={16} className="motion-safe:animate-spin" />Cargando biblioteca…</div> :
                visible.length ? visible.map((item) => {
                  const active = item.id === selected?.id;
                  return <button key={item.id} role="option" aria-selected={active} className={`mb-1 flex min-h-[70px] w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition ${active ? "bg-[var(--surface-selected)]" : "hover:bg-[var(--surface-hover)]"}`} onClick={() => setSelectedId(item.id)}>
                    <span className={`grid size-10 shrink-0 place-items-center rounded-[12px] ${active ? "bg-[var(--surface-raised)] text-[var(--text)]" : "bg-[var(--surface-muted)] text-[var(--text-secondary)]"}`}>{icon(item.type)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-[var(--text)]">{item.name}</span><span className="mt-1 block truncate text-[10px] text-[var(--text-subtle)]">{label(item.type)} · {item.projectName}</span></span>
                    <span className="shrink-0 text-[9px] tabular-nums text-[var(--text-subtle)]">{formatSize(item.size)}</span>
                  </button>;
                }) : <div className="grid min-h-48 place-items-center px-8 text-center"><div className="workspace-empty-state"><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--surface-muted)] text-[var(--text-subtle)]"><File size={19} /></span><p className="mt-3 text-[13px] font-semibold text-[var(--text)]">No hay resultados</p><p className="mt-1 text-[11px] leading-5 text-[var(--text-subtle)]">Prueba otro filtro o busca por nombre, proyecto o conversación.</p></div></div>}
            </div>
          </div>

          <div className="scrollbar-thin hidden min-h-0 flex-1 overflow-y-auto bg-[var(--surface)] p-5 md:block lg:p-8">
            {selected ? <div className="mx-auto flex min-h-full max-w-xl flex-col">
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[var(--surface-raised)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]">{icon(selected.type)}</span>
                <div className="min-w-0 flex-1"><h3 className="break-words text-[16px] font-semibold text-[var(--text)]">{selected.name}</h3><p className="mt-1 text-[11px] text-[var(--text-subtle)]">{label(selected.type)} · {formatSize(selected.size) ?? "Tamaño no disponible"}</p></div>
              </div>
              <div className="mt-5 grid min-h-64 flex-1 place-items-center overflow-hidden rounded-[20px] border border-[var(--border-subtle)] bg-[var(--surface-raised)]">
                {selected.type === "visualization" && selected.artifactId ? <SafeVisualizationPreview artifactId={selected.artifactId} title={selected.name} /> : previewIsImage && selected.previewUrl ? <NextImage unoptimized width={960} height={720} src={selected.previewUrl} alt={`Vista previa de ${selected.name}`} className="max-h-[460px] w-full object-contain" /> : previewIsPdf && selected.previewUrl ? <AuthenticatedPdfPreview previewUrl={selected.previewUrl} title={`Vista previa de ${selected.name}`} className="h-[460px] w-full bg-white" /> : selected.previewUrl ? <iframe sandbox="" referrerPolicy="no-referrer" title={`Vista previa de ${selected.name}`} src={selected.previewUrl} className="h-[460px] w-full bg-white" /> : <div className="px-8 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--surface-muted)] text-[var(--text-subtle)]">{icon(selected.type)}</span><p className="mt-4 text-[13px] font-semibold text-[var(--text)]">Vista previa no disponible</p><p className="mt-1 text-[11px] leading-5 text-[var(--text-subtle)]">Puedes descargar el archivo o abrir la conversación donde se creó.</p></div>}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {selected.downloadUrl ? <a href={selected.downloadUrl} download={selected.name} className="flex min-h-10 items-center gap-2 rounded-full bg-[var(--text)] px-4 text-[12px] font-semibold text-[var(--surface)]"><ArrowDown size={14} />Descargar</a> : null}
                {selected.downloadZipUrl ? <a href={selected.downloadZipUrl} download className="flex min-h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-4 text-[12px] font-semibold text-[var(--text)]"><ArrowDown size={14} />Exportar ZIP</a> : null}
                {selected.previewUrl ? <a href={selected.previewUrl} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-4 text-[12px] font-semibold text-[var(--text)]"><ArrowSquareOut size={14} />Abrir</a> : null}
                {selected.artifactId ? <button type="button" disabled={artifactAction !== null} className="min-h-10 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-4 text-[12px] font-semibold text-[var(--text)] disabled:opacity-50" onClick={() => void publishArtifact()}>{artifactAction === "publish" ? "Publicando…" : selected.internalSiteUrl ? "Actualizar sitio interno" : "Publicar sitio interno"}</button> : null}
                {selected.internalSiteUrl ? <a href={selected.internalSiteUrl} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2 rounded-full bg-[var(--positive)] px-4 text-[12px] font-semibold text-white"><ArrowSquareOut size={14} />Ver sitio interno</a> : null}
                <button type="button" className="min-h-10 rounded-full px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]" onClick={() => onOpenConversation(selected.threadId, selected.messageId)}>Ver conversación</button>
              </div>
              {selected.type === "result" ? <div className="mt-4 rounded-[16px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3"><p className="text-[11px] font-semibold text-[var(--text)]">Crear desde esta respuesta</p><p className="mt-1 text-[10px] leading-4 text-[var(--text-subtle)]">La visualización usa una tabla numérica existente. El sitio interno conserva el contenido y elimina código inseguro.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={artifactAction !== null} className="min-h-9 rounded-full bg-[var(--surface-muted)] px-3 text-[11px] font-medium text-[var(--text)] disabled:opacity-50" onClick={() => void createArtifact("visualization")}>{artifactAction === "visualization" ? "Creando…" : "Crear visualización"}</button><button type="button" disabled={artifactAction !== null} className="min-h-9 rounded-full bg-[var(--surface-muted)] px-3 text-[11px] font-medium text-[var(--text)] disabled:opacity-50" onClick={() => void createArtifact("internal-site")}>{artifactAction === "internal-site" ? "Creando…" : "Crear sitio interno"}</button></div></div> : null}
              {artifactNotice ? <p className="mt-3 text-[10px] leading-4 text-[var(--text-secondary)]" role="status">{artifactNotice}</p> : null}
              <p className="mt-3 truncate text-[10px] text-[var(--text-subtle)]">{selected.projectName} · {selected.threadTitle}</p>
            </div> : <div className="workspace-empty-state m-auto text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--surface-muted)] text-[var(--text-subtle)]"><ImagesSquare size={20} /></span><p className="mt-3 font-semibold text-[var(--text)]">Selecciona un elemento</p><p className="mt-1">Aquí podrás previsualizarlo, descargarlo o volver a la conversación donde se creó.</p></div>}
          </div>
        </div>

        {selected ? <footer className="flex min-h-14 shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 md:hidden">
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]">{selected.name}</span>
          <button type="button" className="min-h-9 rounded-full px-3 text-[11px] font-medium text-[var(--text-secondary)]" onClick={() => onOpenConversation(selected.threadId, selected.messageId)}>Ver chat</button>
          {selected.downloadUrl ? <a href={selected.downloadUrl} download={selected.name} className="flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--text)] px-3 text-[11px] font-semibold text-[var(--surface)]"><ArrowDown size={13} />Descargar</a> : null}
        </footer> : null}
      </section>
    </div>
  );
}
