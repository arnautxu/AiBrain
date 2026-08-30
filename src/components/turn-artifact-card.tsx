"use client";

import NextImage from "next/image";
import {
  Browser,
  DownloadSimple,
  Eye,
  FileDoc,
  FilePdf,
  FilePpt,
  FileText,
  FileXls,
  ImagesSquare,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import type { BrowserArtifact, DocumentArtifact, GeneratedArtifact } from "@/lib/chat-contract";

const publicationCopy: Record<NonNullable<DocumentArtifact["publicationStatus"]>, string> = {
  awaiting_confirmation: "Pendiente de confirmación segura",
  publishing: "Publicando…",
  published: "Publicado y versionado",
  declined: "Publicación rechazada",
  conflict: "Conflicto: el original ha cambiado",
};

const browserStatusCopy: Record<BrowserArtifact["status"], string> = {
  starting: "Iniciando navegador…",
  ready: "Navegador listo",
  active: "Sesión activa",
  reconnecting: "Reconectando…",
  disconnected: "Sesión desconectada",
  closed: "Viewer cerrado",
  error: "Error de sesión",
};

const browserControlCopy: Record<NonNullable<BrowserArtifact["control"]>, string> = {
  agent: "Control del agente",
  employee: "Tienes el control",
  awaiting_approval: "Aprobación pendiente",
};

function DocumentIcon({ kind }: { kind: DocumentArtifact["kind"] }) {
  if (kind === "pdf") return <FilePdf size={18} />;
  if (kind === "docx") return <FileDoc size={18} />;
  if (kind === "xlsx") return <FileXls size={18} />;
  if (kind === "pptx") return <FilePpt size={18} />;
  return <FileText size={18} />;
}

function DocumentCard({ artifact, onPreview }: {
  artifact: DocumentArtifact;
  onPreview?: (artifact: DocumentArtifact) => void;
}) {
  return (
    <article className="max-w-[420px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]">
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--surface-muted)] text-[var(--text-secondary)]"><DocumentIcon kind={artifact.kind} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[11px] font-semibold text-[var(--text)]">{artifact.name}</h3>
          <p className="mt-0.5 text-[9px] text-[var(--text-muted)]">{artifact.kind.toUpperCase()} · {Math.ceil(artifact.size / 1024)} KB{artifact.pages ? ` · ${artifact.pages} ${artifact.pages === 1 ? "página" : "páginas"}` : ""}</p>
        </div>
        {artifact.status === "ready" && artifact.previewUrl && onPreview ? <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text)] active:scale-[0.98]" aria-label={`Previsualizar ${artifact.name}`} title="Vista previa" onClick={() => onPreview(artifact)}><Eye size={15} /></button> : null}
        {artifact.status === "ready" ? <a href={artifact.url} download={artifact.name} className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text)] active:scale-[0.98]" aria-label={`Descargar ${artifact.name}`} title="Descargar"><DownloadSimple size={15} /></a> : null}
      </header>
      {artifact.status === "processing" ? (
        <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-[9px] text-[var(--text-muted)]" role="status"><SpinnerGap size={12} className="motion-safe:animate-spin" />Preparando una vista previa segura…</div>
      ) : artifact.status === "error" ? (
        <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-[9px] text-[var(--danger)]" role="alert"><WarningCircle size={13} />{artifact.error ?? "No se ha podido generar la vista previa."}</div>
      ) : artifact.previewUrl && onPreview ? (
        <button type="button" className="flex min-h-10 w-full items-center justify-between border-t border-[var(--border-subtle)] px-3 text-left text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] active:bg-[var(--surface-selected)]" onClick={() => onPreview(artifact)}><span>Revisar antes de descargar</span><span aria-hidden>›</span></button>
      ) : artifact.previewUrl ? (
        <details className="border-t border-[var(--border-subtle)]">
          <summary className="cursor-pointer list-none px-3 py-2 text-[9px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] [&::-webkit-details-marker]:hidden">Vista previa ›</summary>
          <a href={artifact.url} target="_blank" rel="noreferrer" className="block bg-[var(--surface-muted)] p-3" aria-label={`Abrir ${artifact.name}`}>
            <NextImage unoptimized width={960} height={540} src={artifact.previewUrl} alt={`Vista previa de ${artifact.name}`} className="mx-auto max-h-72 w-auto rounded-md border border-[var(--border)] bg-white object-contain shadow-[var(--shadow-sm)]" />
          </a>
        </details>
      ) : (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2 text-[9px] text-[var(--text-muted)]">Documento listo para descargar.</div>
      )}
      {artifact.publicationStatus || artifact.publicationError ? <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-[9px]">{artifact.publicationError ? <span className="font-medium text-[var(--danger)]" role="alert">{artifact.publicationError}</span> : artifact.publicationStatus ? <span className="font-medium text-[var(--text)]">{publicationCopy[artifact.publicationStatus]}</span> : null}{artifact.targetLabel ? <span className="max-w-52 truncate text-[var(--text-muted)]">{artifact.targetLabel}</span> : null}</footer> : null}
    </article>
  );
}

export function TurnArtifactCard({ artifact, onPreviewDocument, onOpenBrowser }: {
  artifact: GeneratedArtifact;
  onPreviewDocument?: (artifact: DocumentArtifact) => void;
  onOpenBrowser?: () => void;
}) {
  if (artifact.type === "document") return <DocumentCard artifact={artifact} onPreview={onPreviewDocument} />;
  if (artifact.type === "browser") {
    return (
      <article className="max-w-[420px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]">
        <header className="flex items-center gap-2.5 px-3 py-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--surface-muted)]"><Browser size={16} className="text-[var(--text-secondary)]" /></span><div className="min-w-0 flex-1"><h3 className="truncate text-[11px] font-semibold text-[var(--text)]">{artifact.name}</h3><p className="mt-0.5 text-[9px] text-[var(--text-muted)]">{browserStatusCopy[artifact.status]}</p></div>{onOpenBrowser ? <button type="button" className="text-[9px] font-semibold text-[var(--text)] hover:underline" onClick={onOpenBrowser}>Abrir</button> : artifact.viewerUrl ? <a href={artifact.viewerUrl} target="_blank" rel="noreferrer" className="text-[9px] font-semibold text-[var(--text)] hover:underline">Abrir</a> : null}</header>
        {!artifact.viewerUrl && (artifact.status === "starting" || artifact.status === "reconnecting" || artifact.status === "error" || artifact.status === "disconnected" || artifact.status === "closed") ? <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-[9px] text-[var(--text-muted)]" role={artifact.status === "error" ? "alert" : "status"}>{artifact.status === "starting" || artifact.status === "reconnecting" ? <SpinnerGap size={12} className="motion-safe:animate-spin" /> : <WarningCircle size={12} />}{artifact.error ?? (artifact.status === "disconnected" ? "La conexión se ha perdido." : artifact.status === "closed" ? "El viewer se ha cerrado de forma segura." : "Preparando la sesión aislada…")}</div> : null}
        {artifact.control || artifact.downloadUrl ? <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-[9px] text-[var(--text-muted)]">{artifact.control ? <span className="font-medium">{browserControlCopy[artifact.control]}</span> : <span />}{artifact.downloadUrl ? <a href={artifact.downloadUrl} download className="font-medium text-[var(--text)] hover:underline">Descargar resultado</a> : null}</footer> : null}
      </article>
    );
  }
  return (
    <figure className="overflow-hidden rounded-[calc(var(--brain-radius)+2px)] border border-[var(--border)] bg-[var(--surface-muted)]">
      <a href={artifact.url} target="_blank" rel="noreferrer"><NextImage unoptimized width={720} height={720} src={artifact.url} alt={artifact.prompt ?? artifact.name} className="aspect-square w-full object-cover" /></a>
      <figcaption className="flex items-center gap-2 px-3 py-2 text-[9px] text-[var(--text-muted)]"><ImagesSquare size={12} /><span className="min-w-0 flex-1 truncate">{artifact.prompt ?? artifact.name}</span><a href={artifact.url} download={artifact.name} className="font-medium text-[var(--text)] hover:underline">Descargar</a></figcaption>
    </figure>
  );
}
