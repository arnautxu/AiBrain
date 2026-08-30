import "server-only";

import type { DynamicToolCallParams } from "../../contracts/codex/0.149.1/types/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../contracts/codex/0.149.1/types/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../contracts/codex/0.149.1/types/v2/DynamicToolSpec";
import type { JsonValue } from "../../contracts/codex/0.149.1/types/serde_json/JsonValue";
import type { AuthSession } from "@/auth/types";
import { DEFAULT_AUTOMATION_EXECUTION_CONTEXT, isRecord, isValidTimeZone, parseAutomationInput } from "@/automations/contracts";
import { FileAutomationProposalStore } from "@/automations/chat-proposal-store";
import { automationWorkspaceForSession, createAutomationTask, validateAutomationAudience } from "@/automations/server-service";
import { getProject, loadWorkbench } from "@/workbench/store";
import { STANDALONE_PROJECT_SLUG } from "@/workbench/types";

export {
  FileAutomationProposalStore,
  isExplicitAutomationConfirmation,
} from "@/automations/chat-proposal-store";

export const AIBRAIN_AUTOMATION_TOOL_NAMESPACE = "aibrain_automations";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const scheduleSchema: JsonValue = {
  oneOf: [
    { type: "object", properties: { kind: { const: "once" }, runAt: { type: "string", format: "date-time" } }, required: ["kind", "runAt"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "daily" }, hour: { type: "integer", minimum: 0, maximum: 23 }, minute: { type: "integer", minimum: 0, maximum: 59 } }, required: ["kind", "hour", "minute"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "weekly" }, weekdays: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, minItems: 1, maxItems: 7, uniqueItems: true }, hour: { type: "integer", minimum: 0, maximum: 23 }, minute: { type: "integer", minimum: 0, maximum: 59 } }, required: ["kind", "weekdays", "hour", "minute"], additionalProperties: false },
  ],
};

export const AUTOMATION_DYNAMIC_TOOLS: readonly DynamicToolSpec[] = Object.freeze([{
  type: "namespace",
  name: AIBRAIN_AUTOMATION_TOOL_NAMESPACE,
  description: "Prepare and explicitly confirm AiBrain scheduled work. A proposal never runs until the authenticated user confirms it in a later chat message.",
  tools: [{
    type: "function",
    name: "propose",
    description: "Prepare a complete automation proposal only after schedule, timezone, project or Sin proyecto, audience, and action are known. Return the proposal summary and ask the user to confirm it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 100 },
        prompt: { type: "string", minLength: 1, maxLength: 20_000 },
        projectId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
        timeZone: { type: "string", minLength: 1, maxLength: 80 },
        schedule: scheduleSchema,
        audience: {
          type: "object",
          properties: {
            membershipPolicy: { const: "current" },
            userIds: { type: "array", items: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, maxItems: 200, uniqueItems: true },
            groupIds: { type: "array", items: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, maxItems: 200, uniqueItems: true },
          },
          required: ["membershipPolicy", "userIds", "groupIds"],
          additionalProperties: false,
        },
      },
      required: ["name", "prompt", "projectId", "timeZone", "schedule", "audience"],
      additionalProperties: false,
    } as JsonValue,
  }, {
    type: "function",
    name: "confirm",
    description: "Create the latest pending proposal in this conversation only after the user explicitly confirms it in a later message. Pass proposalId when available; omit it only to confirm the single latest pending proposal. Never call in the same turn as propose.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } },
      additionalProperties: false,
    } as JsonValue,
  }],
}]);

/**
 * App Server fixes dynamic tools when a private thread is created.  This
 * deliberately narrow detector lets the chat route re-bootstrap a legacy
 * thread before a scheduling request reaches the model, without discarding
 * normal conversation continuity after every product upgrade.
 */
export function needsAutomationChatTools(message: string) {
  const normalized = message.trim();
  if (!normalized) return false;
  if (/^(?:confirmo|confirmar|confírmala|confirmala|adelante|créala|creala|actívala|activala)(?:\b|[,.!;:]|$)/iu.test(normalized)) {
    return true;
  }
  return /\b(?:automatiz(?:a|ación|acion|ar)|automation|recordatorio|reminder|recuérdame|recuerdame|avísame|avisame|prográmame|programame|programa(?:r)?|schedule)\b/iu.test(normalized) ||
    /\b(?:cada|todos?\s+los?|every)\b.{0,80}\b(?:minutos?|horas?|días?|dias?|semanas?|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|day|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/iu.test(normalized) ||
    /\b(?:dentro\s+de|en)\s+\d{1,4}\s+(?:minutos?|horas?|minutes?|hours?)\b/iu.test(normalized);
}

function success(value: unknown): DynamicToolCallResponse {
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

function strictObject(value: unknown, keys: readonly string[]) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"));
}

export async function automationChatDeveloperInstructions(session: AuthSession, defaults: {
  projectId: string;
  currentTime?: Date;
  timeZone?: string;
}) {
  const [{ directory }, workbench] = await Promise.all([
    import("@/automations/server-service").then(({ listAutomationTasks }) => listAutomationTasks(session)),
    loadWorkbench(session),
  ]);
  const currentProject = workbench.projects.find((project) => project.id === defaults.projectId && project.status === "active");
  const timeZone = isValidTimeZone(defaults.timeZone) ? defaults.timeZone : "Europe/Madrid";
  const currentTime = defaults.currentTime && Number.isFinite(defaults.currentTime.getTime())
    ? defaults.currentTime
    : new Date();
  return [
    "## Creación de automatizaciones desde chat",
    "Reconoce instrucciones naturales de programación, incluidas expresiones relativas como «envíame hello dentro de 2 minutos», «mañana a las 9» o «cada lunes». Calcula runAt desde currentTime y la zona indicada abajo.",
    "Si el usuario no indica proyecto, zona horaria o audiencia, usa directamente el proyecto actual, la zona por defecto y el usuario actual indicados en defaults; no pidas aclaraciones por esos campos. Conserva en el prompt las menciones @ y las referencias a archivos o skills que el usuario haya escrito.",
    "Usa aibrain_automations.propose cuando estén claros acción y horario. Después presenta acción, horario, zona horaria, proyecto o Sin proyecto y audiencia, y pide confirmación. No llames a confirm en el mismo turno. Ante un mensaje posterior inequívoco como «sí», «confirmo» o «adelante», llama a confirm aunque el usuario no repita el id de propuesta.",
    "Cada ejecución background tendrá búsqueda web activa y volverá a resolver las skills y conectores @ actualmente autorizados; una revocación hará que dejen de estar disponibles. Nunca prometas una escritura sensible que no tenga autorización durable previa.",
    "BEGIN AIBRAIN AUTOMATION DIRECTORY JSON",
    JSON.stringify({
      projects: workbench.projects.filter((project) => project.status === "active").map((project) => ({ id: project.id, name: project.slug === STANDALONE_PROJECT_SLUG ? "Sin proyecto" : project.name })),
      audience: directory,
      defaults: {
        currentTime: currentTime.toISOString(),
        timeZone,
        projectId: currentProject?.id ?? null,
        projectName: currentProject
          ? currentProject.slug === STANDALONE_PROJECT_SLUG ? "Sin proyecto" : currentProject.name
          : null,
        audience: directory.currentUserId
          ? { membershipPolicy: "current", userIds: [directory.currentUserId], groupIds: [] }
          : null,
      },
    }),
    "END AIBRAIN AUTOMATION DIRECTORY JSON",
  ].join("\n");
}

export async function handleAutomationToolCall(params: DynamicToolCallParams, context: {
  session: AuthSession;
  sourceThreadId: string;
  sourceTurnId: string;
  sourceMessage: string;
  runtimeThreadId: string;
  runtimeTurnId: string;
  usersRoot: string;
}) {
  if (!strictObject(params, ["threadId", "turnId", "callId", "namespace", "tool", "arguments"]) ||
      params.namespace !== AIBRAIN_AUTOMATION_TOOL_NAMESPACE || typeof params.callId !== "string" ||
      params.threadId !== context.runtimeThreadId || params.turnId !== context.runtimeTurnId) {
    throw new Error("La llamada de automatización no es válida.");
  }
  const store = new FileAutomationProposalStore({ installationId: context.session.tenant.id, userId: context.session.user.id, usersRoot: context.usersRoot });
  if (params.tool === "propose") {
    if (!strictObject(params.arguments, ["name", "prompt", "projectId", "timeZone", "schedule", "audience"])) throw new Error("La propuesta de automatización está incompleta.");
    const raw = params.arguments as Record<string, unknown>;
    const project = typeof raw.projectId === "string" && UUID.test(raw.projectId) ? await getProject(context.session, raw.projectId) : null;
    if (!project || project.status !== "active") throw new Error("El proyecto de la automatización no está disponible.");
    const parsed = parseAutomationInput({ ...raw, projectName: project.slug === STANDALONE_PROJECT_SLUG ? "Sin proyecto" : project.name, executionContext: DEFAULT_AUTOMATION_EXECUTION_CONTEXT });
    if (!parsed) throw new Error("La propuesta de automatización no es válida.");
    const workspace = await automationWorkspaceForSession(context.session);
    parsed.audience = validateAutomationAudience(parsed.audience!, workspace, context.session.user.id);
    const proposal = await store.propose(parsed, { sourceThreadId: context.sourceThreadId, sourceTurnId: context.sourceTurnId, callId: params.callId });
    return success({ status: "pending-user-confirmation", proposalId: proposal.id, action: parsed.prompt, schedule: parsed.schedule, timeZone: parsed.timeZone, project: parsed.projectName, audience: parsed.audience, webSearch: "always", authorizedSkillsAndConnectors: "revalidated-on-every-run" });
  }
  if (params.tool === "confirm") {
    const keys = isRecord(params.arguments) ? Object.keys(params.arguments) : [];
    const proposalId = isRecord(params.arguments) && "proposalId" in params.arguments ? params.arguments.proposalId : null;
    if (!isRecord(params.arguments) || keys.some((key) => key !== "proposalId") || keys.length > 1 ||
        !(proposalId === null || (typeof proposalId === "string" && UUID.test(proposalId)))) {
      throw new Error("La confirmación de automatización no es válida.");
    }
    const proposal = await store.confirm(proposalId, { sourceThreadId: context.sourceThreadId, currentTurnId: context.sourceTurnId, currentMessage: context.sourceMessage }, async (item) => {
      const project = await getProject(context.session, item.input.projectId);
      if (project.status !== "active") throw new Error("El proyecto ya no está disponible.");
      // The proposal already froze the validated project label and audience.
      // Revalidating availability is required; rewriting its input during a
      // recovery would break idempotent reconciliation for the fixed taskId.
      await createAutomationTask(context.session, item.input, { taskId: item.taskId });
    });
    return success({ status: "created", taskId: proposal.taskId, proposalId: proposal.id });
  }
  throw new Error("La herramienta de automatización no está permitida.");
}
