"use client";

import {
  Brain,
  Check,
  Circle,
  FileCode,
  GitDiff,
  Globe,
  ListChecks,
  Robot,
  ShieldCheck,
  SpinnerGap,
  TerminalWindow,
  Wrench,
  X,
} from "@phosphor-icons/react";
import type {
  ActivityItem,
  ApprovalDecision,
  ApprovalItem,
  ChatMessage,
} from "@/lib/chat-contract";

type TurnActivityProps = {
  message: ChatMessage;
  compact?: boolean;
  showDiff?: boolean;
  onResolveApproval: (approval: ApprovalItem, decision: ApprovalDecision) => void;
};

const SYSTEM_ACTIVITY_LABELS: Record<string, string> = {
  "Resultat aprovat": "Resultado aprobado",
  "Resultat pendent de revisió": "Resultado pendiente de revisión",
  "Revertint els canvis": "Deshaciendo los cambios",
  "Canvis revertits i verificats": "Cambios deshechos y verificados",
};

function ActivityIcon({ item }: { item: ActivityItem }) {
  if (item.status === "running" || item.status === "waiting") {
    return <SpinnerGap size={13} className="motion-safe:animate-spin" />;
  }
  if (item.status === "failed" || item.status === "stopped") return <X size={12} weight="bold" />;

  const props = { size: 13, weight: "regular" as const };
  if (item.kind === "command") return <TerminalWindow {...props} />;
  if (item.kind === "file") return <FileCode {...props} />;
  if (item.kind === "web") return <Globe {...props} />;
  if (item.kind === "agent") return <Robot {...props} />;
  if (item.kind === "reasoning") return <Brain {...props} />;
  if (item.kind === "plan") return <ListChecks {...props} />;
  if (item.kind === "tool") return <Wrench {...props} />;
  return <Check {...props} weight="bold" />;
}

function activeActivityLabel(item: ActivityItem) {
  return {
    command: "Ejecutando comando",
    file: "Editando archivos",
    reasoning: "Pensando",
    web: "Buscando en la web",
    tool: "Usando herramienta",
    agent: "Coordinando agentes",
    plan: "Preparando el plan",
    system: SYSTEM_ACTIVITY_LABELS[item.label] ?? item.label,
  }[item.kind];
}

function friendlyActivity(item: ActivityItem) {
  if (item.status === "running" || item.status === "waiting") return activeActivityLabel(item);
  if (item.status === "failed") return `No se ha podido completar: ${item.label}`;
  if (item.status === "stopped") return `Paso detenido: ${item.label}`;
  if (item.status === "pending") return `Pendiente: ${item.label}`;
  return {
    command: "Comando completado",
    file: "Cambios preparados",
    reasoning: "Respuesta preparada",
    web: "Información consultada",
    tool: "Herramienta completada",
    agent: "Coordinación completada",
    plan: "Pasos preparados",
    system: SYSTEM_ACTIVITY_LABELS[item.label] ?? item.label,
  }[item.kind];
}

function currentActivityLabel(message: ChatMessage) {
  for (let index = message.activity.length - 1; index >= 0; index -= 1) {
    const item = message.activity[index];
    if (item.status === "running" || item.status === "waiting") return activeActivityLabel(item);
  }
  const latestItem = message.activity.at(-1);
  return latestItem ? activeActivityLabel(latestItem) : "Pensando";
}

function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: ApprovalItem;
  onResolve: (decision: ApprovalDecision) => void;
}) {
  const pending = approval.status === "pending";
  const result = {
    accepted: "Permitido una vez",
    accepted_session: "Permitido durante esta tarea",
    declined: "Acción rechazada",
    pending: "Esperando tu decisión",
  }[approval.status];
  const title = approval.title;
  const explanation = approval.kind === "file"
    ? "AiBrain ha preparado cambios en el proyecto. Solo se aplicarán si los autorizas."
    : approval.kind === "browser"
      ? "La siguiente acción del navegador necesita tu permiso antes de continuar."
      : "Este comando necesita tu permiso. Puedes permitirlo una vez, durante esta tarea o rechazarlo.";

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]" role="group" aria-label={`Aprobación: ${title}`}>
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
              <p>{approval.detail}</p>
              {approval.command ? <pre tabIndex={0} className="scrollbar-thin mt-2 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[8px] text-[var(--text)]">{approval.command}</pre> : null}
            </div>
          </details>
        </div>
      </div>

      {pending ? (
        <div className="flex flex-wrap justify-end gap-1.5 border-t border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-2">
          <button type="button" className="min-h-9 rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]" onClick={() => onResolve("decline")}>Rechazar</button>
          {approval.kind === "command" ? (
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

export function TurnActivity({ message, compact = false, showDiff = true, onResolveApproval }: TurnActivityProps) {
  const hasDetails = message.plan.length > 0 || message.activity.length > 0 || message.approvals.length > 0 || Boolean(message.diff);
  if (!hasDetails) return null;
  const executionLabel = message.status === "streaming"
    ? currentActivityLabel(message)
    : message.status === "stopped"
      ? "Pensamiento interrumpido"
      : message.status === "error"
        ? "Trabajo interrumpido"
        : "Trabajo completado";

  return (
    <div className={compact ? "space-y-4" : "mt-4 space-y-3"}>
      {message.plan.length > 0 || message.activity.length > 0 ? (
        <details
          className="group/execution"
          open={compact ? true : undefined}
        >
          <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg py-1 text-[16px] font-normal leading-5 text-[var(--text-muted)] transition-colors hover:text-[var(--text)] [&::-webkit-details-marker]:hidden">
            {message.status === "streaming" ? <SpinnerGap size={14} className="motion-safe:animate-spin" /> : message.status === "stopped" || message.status === "error" ? <X size={14} /> : <Check size={14} />}
            <span aria-live="polite" className={message.status === "streaming" ? "activity-shimmer" : undefined}>{executionLabel}</span>
            <span aria-hidden className="transition group-open/execution:rotate-90">›</span>
          </summary>
          <div className="mt-3 space-y-4 border-l border-[var(--border-subtle)] pl-4">
            {message.plan.length > 0 ? (
              <section>
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]">
            <ListChecks size={15} />
            Plan
          </div>
          <ol className="space-y-1.5">
            {message.plan.map((step, index) => (
              <li key={`${step.step}-${index}`} className="flex items-start gap-2.5 text-[13px] leading-5 text-[var(--text)]">
                <span className={`mt-[3px] grid size-3.5 shrink-0 place-items-center rounded-full ${
                  step.status === "completed"
                    ? "bg-[var(--positive-soft)] text-[var(--positive)]"
                    : step.status === "in_progress"
                      ? "bg-[var(--brain-accent-soft)] text-[var(--brain-accent-on-soft)]"
                      : "text-[var(--text-muted)]"
                }`}>
                  {step.status === "completed" ? <Check size={8} weight="bold" /> : step.status === "in_progress" ? <SpinnerGap size={8} className="motion-safe:animate-spin" /> : <Circle size={8} />}
                </span>
                <span>{step.step}</span>
              </li>
            ))}
          </ol>
              </section>
            ) : null}

            {message.activity.length > 0 ? (
              <section className="space-y-0.5">
          {message.activity.map((item) => (
            <div key={item.id} className={`flex items-start gap-2.5 px-1 py-2 ${item.status === "running" || item.status === "waiting" ? "activity-live-row" : ""}`}>
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md ${
                item.status === "failed" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-raised)] text-[var(--text)]"
              }`}>
                <ActivityIcon item={item} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-[14px] font-medium leading-5 text-[var(--text)] ${item.status === "running" || item.status === "waiting" ? "activity-shimmer" : ""}`}>{friendlyActivity(item)}</p>
                {item.detail ? <p className="mt-0.5 text-[12px] leading-[18px] text-[var(--text-muted)]">{item.detail}</p> : null}
                {item.output ? (
                  <details className="mt-2">
                    <summary className="w-fit cursor-pointer text-[9px] font-medium text-[var(--text)]">Ver salida</summary>
                    <pre tabIndex={0} className="scrollbar-thin mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[#222220] px-2.5 py-2 font-mono text-[9px] leading-4 text-[#deddd9]">{item.output}</pre>
                  </details>
                ) : null}
              </div>
            </div>
          ))}
              </section>
            ) : null}
          </div>
        </details>
      ) : null}

      {message.approvals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} onResolve={(decision) => onResolveApproval(approval, decision)} />
      ))}

      {message.diff && showDiff ? (
        <section className="flex max-w-[360px] items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[var(--text)]">
          <GitDiff size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
          <div><p className="text-[10px] font-semibold">Cambios preparados</p><p className="mt-0.5 text-[9px] leading-4 text-[var(--text-muted)]">Disponibles en Review</p></div>
        </section>
      ) : null}
    </div>
  );
}
