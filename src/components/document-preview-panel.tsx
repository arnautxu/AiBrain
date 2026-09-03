"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, DownloadSimple, FileDoc, FilePdf, FilePpt, FileText, FileXls, WarningCircle, X } from "@phosphor-icons/react";
import type { DocumentArtifact } from "@/lib/chat-contract";
import { AuthenticatedPdfPreview } from "@/components/authenticated-pdf-preview";
import { AuthenticatedTextPreview } from "@/components/authenticated-text-preview";
import { AuthenticatedSpreadsheetPreview } from "@/components/authenticated-spreadsheet-preview";
import { useModalFocus } from "@/ui/use-modal-focus";

function documentIcon(kind: DocumentArtifact["kind"]) {
  if (kind === "docx") return <FileDoc size={17} />;
  if (kind === "xlsx") return <FileXls size={17} />;
  if (kind === "pptx") return <FilePpt size={17} />;
  if (kind === "text") return <FileText size={17} />;
  return <FilePdf size={17} />;
}

export function DocumentPreviewPanel({ artifact, onClose }: {
  artifact: DocumentArtifact;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(artifact.kind === "text");
  const [failed, setFailed] = useState(!artifact.previewUrl);
  const [reload, setReload] = useState(0);
  const previewKind = artifact.kind === "pdf" ? "PDF" : "documento";
  const [mobileOverlay, setMobileOverlay] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useModalFocus<HTMLElement>(mobileOverlay, onClose, closeButtonRef);
  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setFailed(true), []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1279px)");
    const sync = () => setMobileOverlay(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const retry = () => {
    if (!artifact.previewUrl) return;
    setLoaded(false);
    setFailed(false);
    setReload((current) => current + 1);
  };

  return (
    <aside
      ref={panelRef}
      aria-label={`Vista previa de ${artifact.name}`}
      aria-modal={mobileOverlay ? "true" : undefined}
      role={mobileOverlay ? "dialog" : undefined}
      tabIndex={mobileOverlay ? -1 : undefined}
      className="document-preview-panel fixed inset-0 z-50 flex min-w-0 flex-col bg-[var(--surface)] xl:static xl:z-auto xl:w-[min(48vw,720px)] xl:shrink-0 xl:border-l xl:border-[var(--border)]"
    >
      <header className="flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-3.5 pt-[env(safe-area-inset-top)] xl:h-[52px] xl:pt-0">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--text-secondary)]">{documentIcon(artifact.previewFormat === "spreadsheet" ? "xlsx" : artifact.kind)}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-[var(--text)]">{artifact.name}</h2>
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{artifact.previewFormat === "spreadsheet" ? "Excel · vista de datos" : artifact.kind.toUpperCase()} · representación segura · {Math.max(1, Math.ceil(artifact.size / 1024))} KB{artifact.pages ? ` · ${artifact.pages} ${artifact.pages === 1 ? "página" : "páginas"}` : ""}</p>
        </div>
        <a href={artifact.url} download={artifact.previewFormat === "spreadsheet" ? `${artifact.name}.preview.json` : artifact.name} className="touch-target grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] active:scale-[0.98]" aria-label={artifact.previewFormat === "spreadsheet" ? "Descargar datos de la vista previa" : `Descargar ${artifact.name}`} title="Descargar"><DownloadSimple size={17} /></a>
        <button ref={closeButtonRef} type="button" className="touch-target grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] active:scale-[0.98]" aria-label="Cerrar vista previa" onClick={onClose}><X size={17} /></button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--surface-muted)] p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] md:p-3 xl:pb-3">
        {!loaded && !failed ? (
          <div className="absolute inset-2 z-10 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5 md:inset-3" role="status" aria-label={`Cargando vista previa del ${previewKind}`}>
            <div className="mx-auto h-full max-w-[520px] animate-pulse rounded-md bg-white p-10 shadow-[var(--shadow-sm)]">
              <div className="h-5 w-2/3 rounded bg-[var(--surface-muted)]" />
              <div className="mt-8 space-y-3"><div className="h-3 rounded bg-[var(--surface-muted)]" /><div className="h-3 rounded bg-[var(--surface-muted)]" /><div className="h-3 w-5/6 rounded bg-[var(--surface-muted)]" /></div>
            </div>
          </div>
        ) : null}
        {failed ? (
          <div className="grid h-full place-items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-8 text-center" role="alert">
            <div className="max-w-64"><WarningCircle size={24} className="mx-auto text-[var(--danger)]" /><p className="mt-3 text-[13px] font-semibold text-[var(--text)]">No se ha podido mostrar el {previewKind}</p><p className="mt-1.5 text-[12px] leading-5 text-[var(--text-muted)]">Puedes volver a intentarlo o descargar el archivo original.</p><button type="button" className="touch-target mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] active:scale-[0.98]" onClick={retry}><ArrowClockwise size={14} />Reintentar</button></div>
          </div>
        ) : artifact.previewUrl && artifact.previewFormat === "spreadsheet" ? (
          <AuthenticatedSpreadsheetPreview key={`${artifact.id}:${reload}`} previewUrl={artifact.previewUrl} />
        ) : artifact.previewUrl && artifact.kind === "text" ? (
          <AuthenticatedTextPreview key={`${artifact.id}:${reload}`} previewUrl={artifact.previewUrl} title={`Documento ${artifact.name}`} />
        ) : artifact.previewUrl ? (
          <AuthenticatedPdfPreview
            key={`${artifact.id}:${reload}`}
            previewUrl={artifact.previewUrl}
            title={`Documento ${artifact.name}`}
            className={`h-full w-full rounded-xl border border-[var(--border)] bg-white shadow-[var(--shadow-sm)] transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
            onLoad={handleLoad}
            onError={handleError}
          />
        ) : null}
      </div>
    </aside>
  );
}
