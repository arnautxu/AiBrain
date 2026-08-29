"use client";

import { useCallback, useState } from "react";
import { ArrowClockwise, DownloadSimple, FilePdf, WarningCircle, X } from "@phosphor-icons/react";
import type { DocumentArtifact } from "@/lib/chat-contract";
import { AuthenticatedPdfPreview } from "@/components/authenticated-pdf-preview";

export function DocumentPreviewPanel({ artifact, onClose }: {
  artifact: DocumentArtifact;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(!artifact.previewUrl);
  const [reload, setReload] = useState(0);
  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setFailed(true), []);

  const retry = () => {
    if (!artifact.previewUrl) return;
    setLoaded(false);
    setFailed(false);
    setReload((current) => current + 1);
  };

  return (
    <aside aria-label={`Vista previa de ${artifact.name}`} className="document-preview-panel fixed inset-0 z-40 flex min-w-0 flex-col bg-[var(--surface)] md:static md:z-auto md:w-[min(48vw,720px)] md:shrink-0 md:border-l md:border-[var(--border)]">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-3.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--text-secondary)]"><FilePdf size={17} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-[var(--text)]">{artifact.name}</h2>
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">PDF · {Math.max(1, Math.ceil(artifact.size / 1024))} KB{artifact.pages ? ` · ${artifact.pages} ${artifact.pages === 1 ? "página" : "páginas"}` : ""}</p>
        </div>
        <a href={artifact.url} download={artifact.name} className="touch-target grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] active:scale-[0.98]" aria-label={`Descargar ${artifact.name}`} title="Descargar"><DownloadSimple size={17} /></a>
        <button type="button" className="touch-target grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] active:scale-[0.98]" aria-label="Cerrar vista previa" onClick={onClose}><X size={17} /></button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--surface-muted)] p-2 md:p-3">
        {!loaded && !failed ? (
          <div className="absolute inset-2 z-10 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5 md:inset-3" role="status" aria-label="Cargando vista previa del PDF">
            <div className="mx-auto h-full max-w-[520px] animate-pulse rounded-md bg-white p-10 shadow-[var(--shadow-sm)]">
              <div className="h-5 w-2/3 rounded bg-[var(--surface-muted)]" />
              <div className="mt-8 space-y-3"><div className="h-3 rounded bg-[var(--surface-muted)]" /><div className="h-3 rounded bg-[var(--surface-muted)]" /><div className="h-3 w-5/6 rounded bg-[var(--surface-muted)]" /></div>
            </div>
          </div>
        ) : null}
        {failed ? (
          <div className="grid h-full place-items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-8 text-center" role="alert">
            <div className="max-w-64"><WarningCircle size={24} className="mx-auto text-[var(--danger)]" /><p className="mt-3 text-[13px] font-semibold text-[var(--text)]">No se ha podido mostrar el PDF</p><p className="mt-1.5 text-[12px] leading-5 text-[var(--text-muted)]">Puedes volver a intentarlo o descargar el archivo directamente.</p><button type="button" className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] active:scale-[0.98]" onClick={retry}><ArrowClockwise size={14} />Reintentar</button></div>
          </div>
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
