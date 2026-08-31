"use client";

import { useState } from "react";
import {
  Brain,
  Check,
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
import { ManagedAppActionControl } from "@/components/managed-app-action-control";
import type { ManagedAppActionDescriptor } from "@/ui/codex-managed-app-ui";
import { managedAppActionKey } from "@/ui/codex-managed-app-ui";
import { ToolResultCard } from "@/components/tool-result-list";
import { AgentStatusOrb } from "@/components/agent-status-orb";
import { WorkspaceFilePreview } from "@/components/workspace-file-preview";
import {
  buildTurnTimeline,
  formatWorkDuration,
  turnDurationMs,
} from "@/ui/turn-timeline";
import {
  publicActivityText,
  publicCommandTitle,
  publicProjectPath,
  publicToolOutput,
} from "@/ui/public-activity";
import {
  ThinkingStep,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "@/components/ui/thinking-steps";

type TurnActivityProps = {
  message: ChatMessage;
  projectId?: string;
  compact?: boolean;
  showDiff?: boolean;
  readOnly?: boolean;
  onResolveApproval: (approval: ApprovalItem, decision: ApprovalDecision) => void;
  onOpenReview?: () => void;
  onOpenBrowser?: () => void;
  managedAppAction?: {
    enabled: boolean;
    threadId: string;
    onPrepared: (descriptor: ManagedAppActionDescriptor) => void;
  } | null;
  /** Connector identity remains available while the employee visits another thread. */
  managedAppApprovalKeys?: readonly string[];
};

const SYSTEM_ACTIVITY_LABELS: Record<string, string> = {
  "Resultat aprovat": "Resultado aprobado",
  "Resultat pendent de revisió": "Resultado pendiente de revisión",
  "Revertint els canvis": "Deshaciendo los cambios",
  "Canvis revertits i verificats": "Cambios deshechos y verificados",
  "Preparant el context": "Preparando el contexto",
  "Context preparat": "Contexto preparado",
  "Connectant amb Codex": "Conectando con el asistente",
  "Codex connectat": "El asistente está listo",
  "Obrint la conversa": "Abriendo la conversación",
  "Conversa oberta": "Conversación abierta",
  "Recuperant la conversa": "Recuperando la conversación",
  "Conversa recuperada": "Conversación recuperada",
  "Iniciant el torn": "Iniciando la tarea",
  "Torn iniciat": "Tarea iniciada",
  "Torn recuperat": "Tarea recuperada",
  "Recuperant el torn": "Recuperando la tarea",
  "No s’ha pogut recuperar el torn": "No se ha podido recuperar la tarea",
  "Esperant activitat del model": "Esperando actividad del modelo",
  "Codex està treballant": "El asistente está trabajando",
  "Preparant el resum del raonament": "Preparando el resumen del razonamiento",
  "Codex està raonant": "El asistente está preparando la respuesta",
  "Verificant el model": "Verificando el modelo",
  "Canviant de model": "Cambiando de modelo",
  "Verificant la resposta": "Verificando la respuesta",
  "Processant la resposta del model": "Procesando la respuesta del modelo",
  "Resposta del model rebuda": "Respuesta del modelo recibida",
};

const GENERIC_RUNTIME_LABELS = new Set([
  "Executant una ordre",
  "Ordre executada",
  "Preparant canvis",
  "Canvis de fitxers",
  "Cercant al web",
  "Cerca web completada",
  "Raonant",
  "Raonament completat",
  "Preparant el pla",
  "Pla preparat",
  "Coordinant agents",
  "Coordinació completada",
]);

const LIFECYCLE_ACTIVITY_IDS = new Set([
  "runtime-context",
  "runtime-connect",
  "runtime-thread",
  "runtime-thread-recovery",
  "runtime-thread-retry",
  "runtime-turn-start",
  "runtime-turn-recovery",
  "runtime-awaiting-model",
  "runtime-model-active",
  "runtime-reasoning",
  "runtime-model-verification",
  "runtime-model-reroute",
  "runtime-safety-buffering",
  "runtime-response-processing",
  "runtime-performance",
  "client-request-status",
]);

function translatedRuntimeLabel(label: string) {
  return label
    .replace(/^Utilitzant /u, "Usando ")
    .replace(/ completat$/u, " completado");
}

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

function activityPresentation(item: ActivityItem) {
  const detail = publicActivityText(item.detail) ?? undefined;
  const active = item.status === "running" || item.status === "waiting";
  const safeLabel = publicActivityText(item.label, 240) ?? "Actividad completada";
  const customLabel = safeLabel && !GENERIC_RUNTIME_LABELS.has(item.label)
    ? SYSTEM_ACTIVITY_LABELS[item.label] ?? translatedRuntimeLabel(safeLabel)
    : null;
  let title = customLabel;
  let secondaryDetail: string | undefined = detail;

  if (!title) {
    if (item.kind === "reasoning") {
      title = detail || (active ? "Pensando" : "Razonamiento completado");
      secondaryDetail = undefined;
    } else if (item.kind === "command") {
      title = publicCommandTitle(item.detail, active);
      secondaryDetail = undefined;
    } else if (item.kind === "file") {
      title = detail ? `${active ? "Preparando cambios en" : "Cambios preparados en"} ${detail}` : active ? "Editando archivos" : "Cambios preparados";
      secondaryDetail = undefined;
    } else if (item.kind === "web") {
      title = detail ? `${active ? "Buscando" : "Búsqueda completada"}: ${detail}` : active ? "Buscando en la web" : "Información consultada";
      secondaryDetail = undefined;
    } else if (item.kind === "agent") {
      title = detail ? `${active ? "Coordinando" : "Coordinación completada"}: ${detail}` : active ? "Coordinando agentes" : "Coordinación completada";
      secondaryDetail = undefined;
    } else {
      title = {
        tool: active ? "Usando herramienta" : "Herramienta completada",
        plan: active ? "Preparando el plan" : "Plan preparado",
        system: SYSTEM_ACTIVITY_LABELS[item.label] ?? item.label,
      }[item.kind];
    }
  }

  if (item.status === "failed") title = `No se ha podido completar: ${title}`;
  if (item.status === "stopped") title = `Paso detenido: ${title}`;
  if (item.status === "pending") title = `Pendiente: ${title}`;
  return { title, detail: secondaryDetail };
}

/** Runtime lifecycle events remain persisted for diagnostics, but they are not
 * useful steps in the employee-facing work process. Failures stay visible. */
export function isRelevantProcessActivity(item: ActivityItem) {
  if (item.status === "failed" || item.status === "stopped") return true;
  return !LIFECYCLE_ACTIVITY_IDS.has(item.id);
}

export function hasRelevantWorkProcess(
  message: Pick<ChatMessage, "activity" | "plan"> & Partial<Pick<ChatMessage, "toolResults">>,
) {
  return message.plan.some((step) => step.status !== "pending") ||
    message.activity.some((item) => item.status !== "pending" && isRelevantProcessActivity(item)) ||
    Boolean(message.toolResults?.length);
}

export function currentActivityLabel(relevantActivity: ActivityItem[]) {
  for (let index = relevantActivity.length - 1; index >= 0; index -= 1) {
    const item = relevantActivity[index];
    if (item.status === "running" || item.status === "waiting") return activityPresentation(item).title;
  }
  const latestItem = relevantActivity.at(-1);
  return latestItem ? activityPresentation(latestItem).title : "Pensando";
}

/** One safe, factual status for the collapsed live response surface. */
export function currentTurnStatusLabel(message: Pick<ChatMessage, "activity">) {
  return message.activity.length ? currentActivityLabel(message.activity) : null;
}

function ApprovalCard({
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

export function TurnActivity({
  message,
  projectId,
  compact = false,
  showDiff = true,
  readOnly = false,
  onResolveApproval,
  onOpenReview,
  onOpenBrowser,
  managedAppAction = null,
  managedAppApprovalKeys = [],
}: TurnActivityProps) {
  const streaming = message.status === "streaming";
  const [manualDisclosure, setManualDisclosure] = useState<{
    status: ChatMessage["status"];
    open: boolean;
  } | null>(null);
  const executionOpen = manualDisclosure?.status === message.status
    ? manualDisclosure.open
    : streaming;

  const visiblePlan = message.plan.flatMap((step) => {
    const publicStep = publicActivityText(step.step, 1_000);
    return step.status !== "pending" && publicStep ? [{ ...step, step: publicStep }] : [];
  });
  const visibleActivity = message.activity
    .filter((item) => item.status !== "pending" && isRelevantProcessActivity(item))
    .map((item) => ({
      ...item,
      label: publicActivityText(item.label, 240) ?? "Actividad",
      ...(item.detail ? { detail: publicActivityText(item.detail) ?? undefined } : {}),
      ...(item.output ? { output: publicToolOutput(item.output) ?? undefined } : {}),
      ...(item.files ? {
        files: item.files.flatMap((file) => {
          const safePath = publicProjectPath(file.path);
          return safePath ? [{ ...file, path: safePath }] : [];
        }),
      } : {}),
    }));
  const timeline = buildTurnTimeline(visibleActivity, message.toolResults ?? []);
  const hasWorkProcess = visiblePlan.length > 0 || timeline.length > 0;
  const hasDetails = hasWorkProcess || message.approvals.length > 0 ||
    Boolean(message.diff) || Boolean(message.toolResults?.length);
  if (!hasDetails && !managedAppAction) return null;
  const duration = turnDurationMs(message);
  const executionLabel = message.status === "streaming"
    ? currentActivityLabel(visibleActivity)
    : duration !== null
      ? `Ha trabajado durante ${formatWorkDuration(duration)}`
      : message.status === "stopped"
        ? "Pensamiento interrumpido"
        : message.status === "error"
          ? "Trabajo interrumpido"
          : "Ha trabajado durante unos segundos";

  const activeActivity = [...visibleActivity].reverse().find((item) => item.status === "running" || item.status === "waiting");
  const visibleStepCount = visiblePlan.length + timeline.length;

  return (
    <div className={compact ? "space-y-4" : "mt-4 space-y-3"}>
      {hasWorkProcess ? (
        <ThinkingSteps
          data-testid="turn-thinking-steps"
          size="compact"
          open={executionOpen}
          onOpenChange={(open) => setManualDisclosure({
            status: message.status,
            open,
          })}
          className="w-full"
        >
          <ThinkingStepsHeader
            aria-label={`${executionOpen ? "Ocultar" : "Mostrar"} el proceso de trabajo`}
            aria-live="polite"
            indicator={message.status === "streaming"
              ? <AgentStatusOrb kind={activeActivity?.kind ?? "system"} />
              : message.status === "stopped" || message.status === "error"
                ? <X size={14} />
                : <Check size={14} />}
            labelClassName={message.status === "streaming" ? "thinking-steps-shimmer" : "text-[var(--text-secondary)]"}
            className={message.status === "complete" ? "codex-thinking-summary-complete max-w-full" : "max-w-full"}
          >
            {executionLabel}
          </ThinkingStepsHeader>
          <ThinkingStepsContent className="pt-1">
            {visiblePlan.map((step, index) => (
              <ThinkingStep
                key={`${step.step}-${index}`}
                indicator={streaming && step.status === "in_progress"
                  ? <SpinnerGap size={12} className="motion-safe:animate-spin" />
                  : <ListChecks size={12} />}
                label={step.step}
                status={streaming && step.status === "in_progress" ? "active" : "complete"}
                delay={Math.min(index * 0.035, 0.18)}
                isLast={index === visibleStepCount - 1}
              />
            ))}

            <div role="list" aria-label="Actividad del trabajo">
              {timeline.map((entry, index) => {
                const stepIndex = visiblePlan.length + index;
                if (entry.type === "tool") {
                  return (
                    <div
                      key={entry.key}
                      role="listitem"
                      data-timeline-key={entry.key}
                      className="ml-7 py-1"
                    >
                      <ToolResultCard result={entry.item} onOpenBrowser={onOpenBrowser} />
                    </div>
                  );
                }
                const item = entry.item;
                const presentation = activityPresentation(item);
                return (
                  <div key={entry.key} role="listitem" data-timeline-key={entry.key}>
                    <ThinkingStep
                      indicator={<ActivityIcon item={item} />}
                      label={presentation.title}
                      description={presentation.detail}
                      status={item.status === "running" || item.status === "waiting" ? "active" : "complete"}
                      delay={Math.min(stepIndex * 0.035, 0.18)}
                      isLast={stepIndex === visibleStepCount - 1}
                    >
                      {projectId && item.kind === "file" && item.files?.length ? (
                        <div className="mt-2">
                          {item.files.map((file) => (
                            <WorkspaceFilePreview key={`${file.change}:${file.path}`} projectId={projectId} file={file} />
                          ))}
                        </div>
                      ) : null}
                      {item.output ? (
                        <details className="mt-2">
                          <summary className="w-fit cursor-pointer text-[9px] font-medium text-[var(--text)]">Ver salida</summary>
                          <pre tabIndex={0} className="scrollbar-thin mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[#222220] px-2.5 py-2 font-mono text-[9px] leading-4 text-[#deddd9]">{publicToolOutput(item.output)}</pre>
                        </details>
                      ) : null}
                    </ThinkingStep>
                  </div>
                );
              })}
            </div>
          </ThinkingStepsContent>
        </ThinkingSteps>
      ) : null}

      {message.approvals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} readOnly={readOnly} connectorApproval={managedAppApprovalKeys.includes(managedAppActionKey({ ...approval, approvalId: approval.id }))} onResolve={(decision) => onResolveApproval(approval, decision)} />
      ))}

      {managedAppAction ? <ManagedAppActionControl
        enabled={managedAppAction.enabled}
        threadId={managedAppAction.threadId}
        message={message}
        onPrepared={managedAppAction.onPrepared}
      /> : null}

      {message.diff && showDiff ? onOpenReview ? (
        <button type="button" aria-label="Abrir cambios y resultados" onClick={onOpenReview} className="flex max-w-[360px] items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-left text-[var(--text)]">
          <GitDiff size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
          <div><p className="text-[10px] font-semibold">Abrir cambios y resultados</p><p className="mt-0.5 text-[9px] leading-4 text-[var(--text-muted)]">Incluidos en este turno</p></div>
        </button>
      ) : (
        <section className="flex max-w-[360px] items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[var(--text)]">
          <GitDiff size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
          <div><p className="text-[10px] font-semibold">Cambios preparados</p><p className="mt-0.5 text-[9px] leading-4 text-[var(--text-muted)]">Incluidos en este turno</p></div>
        </section>
      ) : null}
    </div>
  );
}
