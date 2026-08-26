"use client";

import NextImage from "next/image";
import {
  ArrowSquareOut,
  Browser,
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

function DocumentCard({ artifact }: { artifact: DocumentArtifact }) {
  return (
    <article className="overflow-hidden rounded-[calc(var(--brain-radius)+2px)] border border-[var(--border)] bg-[var(--surface-raised)] sm:col-span-2">
      <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3.5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--text-secondary)]"><DocumentIcon kind={artifact.kind} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12px] font-semibold text-[var(--text)]">{artifact.name}</h3>
          <p className="mt-0.5 text-[10px] text-[var(--text)]">{artifact.kind.toUpperCase()} · {Math.ceil(artifact.size / 1024)} KB{artifact.pages ? ` · ${artifact.pages} ${artifact.pages === 1 ? "página" : "páginas"}` : ""}</p>
        </div>
        {artifact.status === "ready" ? <a href={artifact.url} download={artifact.name} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-2 text-[10px] font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"><ArrowSquareOut size={12} />Descargar</a> : null}
      </header>
      {artifact.status === "processing" ? (
        <div className="flex min-h-44 items-center justify-center gap-2 text-[11px] text-[var(--text-muted)]" role="status"><SpinnerGap size={15} className="motion-safe:animate-spin" />Preparando una vista previa segura…</div>
      ) : artifact.status === "error" ? (
        <div className="flex min-h-32 items-center justify-center gap-2 px-5 text-center text-[11px] text-[var(--danger)]" role="alert"><WarningCircle size={16} />{artifact.error ?? "No se ha podido generar la vista previa."}</div>
      ) : artifact.previewUrl ? (
        <div className="bg-[var(--surface-muted)] p-3">
          <a href={artifact.url} target="_blank" rel="noreferrer" className="block" aria-label={`Abrir ${artifact.name}`}>
            <NextImage unoptimized width={960} height={540} src={artifact.previewUrl} alt={`Vista previa de ${artifact.name}`} className="mx-auto max-h-72 w-auto rounded-md border border-[var(--border)] bg-white object-contain shadow-[var(--shadow-sm)]" />
          </a>
          {artifact.pages ? <p className="mt-2 text-center text-[10px] font-medium text-[var(--text)]">Vista previa · Página 1 de {artifact.pages}</p> : null}
        </div>
      ) : (
        <div className="grid min-h-32 place-items-center text-[11px] text-[var(--text-muted)]">Documento listo para descargar.</div>
      )}
      {artifact.publicationStatus || artifact.publicationError ? <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3.5 py-2.5 text-[10px]">{artifact.publicationError ? <span className="font-medium text-[var(--danger)]" role="alert">{artifact.publicationError}</span> : artifact.publicationStatus ? <span className="font-medium text-[var(--text)]">{publicationCopy[artifact.publicationStatus]}</span> : null}{artifact.targetLabel ? <span className="max-w-64 truncate text-[var(--text)]">Destino: {artifact.targetLabel}</span> : null}</footer> : null}
    </article>
  );
}

export function TurnArtifactCard({ artifact }: { artifact: GeneratedArtifact }) {
  if (artifact.type === "document") return <DocumentCard artifact={artifact} />;
  if (artifact.type === "browser") {
    return (
      <article className="overflow-hidden rounded-[calc(var(--brain-radius)+2px)] border border-[var(--border)] bg-[var(--surface-raised)] sm:col-span-2">
        <header className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5 py-3"><Browser size={17} className="text-[var(--text-secondary)]" /><h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text)]">{artifact.name}</h3><span className="text-[10px] font-medium text-[var(--text)]">{browserStatusCopy[artifact.status]}</span></header>
        {(artifact.status === "active" || artifact.status === "ready") && artifact.viewerUrl ? <iframe title={`Sesión de navegador: ${artifact.name}`} src={artifact.viewerUrl} sandbox="allow-scripts allow-forms allow-pointer-lock" referrerPolicy="no-referrer" className="h-72 w-full border-0 bg-white" /> : artifact.captureUrl ? <a href={artifact.captureUrl} target="_blank" rel="noreferrer" aria-label={`Abrir captura de ${artifact.name}`}><NextImage unoptimized width={960} height={540} src={artifact.captureUrl} alt={`Captura de ${artifact.name}`} className="h-72 w-full bg-white object-contain" /></a> : <div className="flex min-h-40 items-center justify-center gap-2 px-5 text-center text-[11px] text-[var(--text)]" role={artifact.status === "error" ? "alert" : "status"}>{artifact.status === "starting" || artifact.status === "reconnecting" ? <SpinnerGap size={15} className="motion-safe:animate-spin" /> : <WarningCircle size={15} />}{artifact.error ?? (artifact.status === "disconnected" ? "La conexión se ha perdido. El agente intentará recuperarla." : artifact.status === "closed" ? "El viewer se ha cerrado de forma segura." : "Preparando la sesión aislada…")}</div>}
        {artifact.control || artifact.downloadUrl ? <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3.5 py-2.5 text-[10px] text-[var(--text)]">{artifact.control ? <span className="font-medium">{browserControlCopy[artifact.control]}</span> : <span />}{artifact.downloadUrl ? <a href={artifact.downloadUrl} download className="font-medium hover:underline">Descargar resultado</a> : null}</footer> : null}
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
