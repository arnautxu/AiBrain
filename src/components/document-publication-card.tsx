"use client";

import { FileArrowUp, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import type { DocumentPublicationDraft } from "@/ui/publication-ui-adapter";
import { isSafePublicationTarget } from "@/ui/publication-ui-adapter";

const terminalCopy: Record<"published" | "declined" | "expired" | "conflict", string> = {
  published: "Publicado y versionado",
  declined: "Publicación rechazada",
  expired: "La confirmación ha caducado. Prepara una nueva publicación.",
  conflict: "El original ha cambiado. Revisa el documento antes de intentarlo de nuevo.",
};

export function DocumentPublicationCard({
  draft,
  onFreeze,
  onDecide,
}: {
  draft: DocumentPublicationDraft;
  onFreeze: (draftId: string, targetRelativePath: string) => Promise<void>;
  onDecide: (draftId: string, action: "confirm" | "decline") => Promise<void>;
}) {
  const [target, setTarget] = useState(draft.targetRelativePath);
  const busy = draft.phase === "freezing" || draft.phase === "deciding";
  const awaiting = draft.phase === "awaiting_confirmation";
  const terminal = draft.phase === "published" || draft.phase === "declined" ||
    draft.phase === "expired" || draft.phase === "conflict";

  return (
    <section className="mt-3 max-w-[420px] rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]" role="group" aria-label={`Publicación de ${draft.fileName}`}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--surface-muted)] text-[var(--text-muted)]"><FileArrowUp size={15} /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-[var(--text)]">{draft.fileName}</p><p className="mt-0.5 text-[9px] text-[var(--text-muted)]">Documento preparado · {Math.ceil(draft.size / 1024)} KB</p></div>
      </div>

      {draft.phase === "ready" || draft.phase === "error" ? (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
          <label className="block text-[9px] font-medium text-[var(--text-muted)]">Destino oficial
            <input aria-label={`Destino de ${draft.fileName}`} value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1.5 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[10px] text-[var(--text)] outline-none focus:border-[var(--brain-accent)]" />
          </label>
          {draft.error ? <p className="mt-2 flex items-start gap-1.5 text-[9px] leading-4 text-[var(--danger)]" role="alert"><WarningCircle size={11} className="mt-0.5 shrink-0" />{draft.error}</p> : null}
          <div className="mt-2 flex justify-end"><button type="button" disabled={!isSafePublicationTarget(target) || busy} className="min-h-8 rounded-md bg-[var(--text)] px-3 text-[9px] font-semibold text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void onFreeze(draft.id, target)}>Preparar publicación</button></div>
        </div>
      ) : null}

      {draft.phase === "freezing" ? <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2.5 text-[9px] text-[var(--text-muted)]" role="status"><SpinnerGap size={12} className="motion-safe:animate-spin" />Verificando candidato, permisos y versión original…</div> : null}

      {awaiting && draft.operation ? (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
          <p className="text-[9px] leading-4 text-[var(--text-muted)]">{draft.operation.original.exists ? "Sustituirá el original y conservará una versión recuperable." : "Creará un documento oficial nuevo."}</p>
          <p className="mt-1 truncate text-[9px] font-medium text-[var(--text)]">{draft.operation.targetRelativePath}</p>
          {draft.error ? <p className="mt-2 flex items-start gap-1.5 text-[9px] leading-4 text-[var(--danger)]" role="alert"><WarningCircle size={11} className="mt-0.5 shrink-0" />{draft.error}</p> : null}
          <div className="mt-2 flex justify-end gap-1.5"><button type="button" className="min-h-8 rounded-md px-3 text-[9px] font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]" onClick={() => void onDecide(draft.id, "decline")}>Rechazar</button><button type="button" className="min-h-8 rounded-md bg-[var(--brain-accent-strong)] px-3 text-[9px] font-semibold text-white" onClick={() => void onDecide(draft.id, "confirm")}>Publicar</button></div>
        </div>
      ) : null}

      {draft.phase === "deciding" ? <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2.5 text-[9px] text-[var(--text-muted)]" role="status"><SpinnerGap size={12} className="motion-safe:animate-spin" />Aplicando la decisión de forma segura…</div> : null}
      {terminal ? <div className="border-t border-[var(--border-subtle)] px-3 py-2.5 text-[9px] font-medium text-[var(--text)]" role="status">{terminalCopy[draft.phase as keyof typeof terminalCopy]}</div> : null}
    </section>
  );
}
