"use client";

import { ShieldCheck } from "@phosphor-icons/react";
import type { ApprovalItem, ApprovalDecision } from "@/lib/chat-contract";
import { publicActivityText, publicCommandTitle } from "@/ui/public-activity";

// AiBrain authorizes exact decisions; the registry's permanent grant is unsupported.
export function PermissionGrant({
  approval,
  onResolve,
  connectorApproval = false,
  readOnly = false,
}: {
  approval: ApprovalItem;
  onResolve: (decision: ApprovalDecision) => void;
  connectorApproval?: boolean;
  readOnly?: boolean;
}) {
  const pending = approval.status === "pending";
  const result = {
    accepted: "Permitido una vez",
    accepted_session: "Permitido durante esta tarea",
    declined: "Acción rechazada",
    pending: "Esperando tu decisión",
  }[approval.status];
  const title = publicActivityText(approval.title, 240) ?? "Acción pendiente";
  const explanation = approval.kind === "file"
    ? "El asistente ha preparado cambios en el proyecto. Solo se aplicarán si los autorizas."
    : approval.kind === "browser"
      ? "La siguiente acción del navegador necesita tu permiso antes de continuar."
      : "Este comando necesita tu permiso. Puedes permitirlo una vez, durante esta tarea o rechazarlo.";

  return (
    <div data-slot="permission-grant" className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]" role="group" aria-label={`Aprobación: ${title}`}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--text)]">
          <ShieldCheck size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-[var(--text)]">{title}</p>
          <p className="mt-1 text-[10px] leading-4 text-[var(--text)]">{explanation}</p>
          <details className="mt-2">
            <summary className="w-fit cursor-pointer text-[9px] font-medium text-[var(--text)]">Ver por qué necesita permiso</summary>
            <div className="mt-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[9px] leading-4 text-[var(--text)]">
              <p>{publicActivityText(approval.detail, 1_000) ?? "Esta acción necesita confirmación."}</p>
              {approval.command ? <p className="mt-2 text-[9px] font-medium text-[var(--text-secondary)]">{publicCommandTitle(approval.command)}</p> : null}
            </div>
          </details>
        </div>
      </div>

      {pending && readOnly ? (
        <div className="border-t border-[var(--border-subtle)] px-3.5 py-2 text-[9px] font-medium text-[var(--text-secondary)]">
          Esperando la decisión de un editor del proyecto
        </div>
      ) : pending ? (
        <div className="flex flex-wrap justify-end gap-1.5 border-t border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-2">
          <button type="button" className="min-h-9 rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]" onClick={() => onResolve("decline")}>Rechazar</button>
          {approval.kind === "command" && !connectorApproval ? (
            <button type="button" className="min-h-9 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]" onClick={() => onResolve("acceptForSession")}>Durante esta tarea</button>
          ) : null}
          <button type="button" className="min-h-9 rounded-lg bg-[var(--brain-accent-strong)] px-2.5 py-1.5 text-[10px] font-semibold text-white" onClick={() => onResolve("accept")}>Permitir</button>
        </div>
      ) : (
        <div className="border-t border-[var(--border-subtle)] px-3.5 py-2 text-[9px] font-medium text-[var(--text)]" role="status">{result}</div>
      )}
    </div>
  );
}
