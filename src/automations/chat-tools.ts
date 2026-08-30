import "server-only";

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { DynamicToolCallParams } from "../../contracts/codex/0.149.1/types/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../contracts/codex/0.149.1/types/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../contracts/codex/0.149.1/types/v2/DynamicToolSpec";
import type { JsonValue } from "../../contracts/codex/0.149.1/types/serde_json/JsonValue";
import type { AuthSession } from "@/auth/types";
import { DEFAULT_AUTOMATION_EXECUTION_CONTEXT, parseAutomationInput, type AutomationTaskInput } from "@/automations/contracts";
import { automationWorkspaceForSession, createAutomationTask, validateAutomationAudience } from "@/automations/server-service";
import { atomicWriteFile, ResourceLockManager } from "@/storage";
import { getProject, loadWorkbench } from "@/workbench/store";
import { STANDALONE_PROJECT_SLUG } from "@/workbench/types";

export const AIBRAIN_AUTOMATION_TOOL_NAMESPACE = "aibrain_automations";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
    description: "Create a pending proposal only after the user explicitly confirms it in a later message. Never call in the same turn as propose.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } },
      required: ["proposalId"],
      additionalProperties: false,
    } as JsonValue,
  }],
}]);

type Proposal = {
  schemaVersion: 1;
  id: string;
  taskId: string;
  installationId: string;
  userId: string;
  sourceThreadId: string;
  sourceTurnId: string;
  callId: string;
  input: AutomationTaskInput;
  status: "pending" | "confirmed";
  createdAt: string;
  confirmedAt: string | null;
};

function parseProposal(value: unknown): Proposal | null {
  if (!strictObject(value, [
    "schemaVersion", "id", "taskId", "installationId", "userId", "sourceThreadId",
    "sourceTurnId", "callId", "input", "status", "createdAt", "confirmedAt",
  ])) return null;
  const proposal = value as Record<string, unknown>;
  const input = parseAutomationInput(proposal.input);
  if (proposal.schemaVersion !== 1 || !UUID.test(String(proposal.id)) || !UUID.test(String(proposal.taskId)) ||
      typeof proposal.installationId !== "string" || typeof proposal.userId !== "string" ||
      typeof proposal.sourceThreadId !== "string" || typeof proposal.sourceTurnId !== "string" ||
      typeof proposal.callId !== "string" || !input ||
      (proposal.status !== "pending" && proposal.status !== "confirmed") ||
      typeof proposal.createdAt !== "string" || !Number.isFinite(Date.parse(proposal.createdAt)) ||
      (proposal.confirmedAt !== null && (typeof proposal.confirmedAt !== "string" || !Number.isFinite(Date.parse(proposal.confirmedAt))))) return null;
  return { ...(proposal as Omit<Proposal, "input">), input } as Proposal;
}

export function isExplicitAutomationConfirmation(message: string) {
  const normalized = message.trim();
  if (/\b(?:no|cancel(?:a|ar|o)?|todavía no|todavia no|aún no|aun no)\b/iu.test(normalized)) return false;
  return /^(?:confirmo|confirmar|confírmala|confirmala|adelante|créala|creala|actívala|activala|sí|si|ok|yes)(?:\b|[,.!;:]|$)/iu.test(normalized);
}

function success(value: unknown): DynamicToolCallResponse {
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

function strictObject(value: unknown, keys: readonly string[]) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"));
}

export class FileAutomationProposalStore {
  private readonly root: string;
  private readonly filePath: string;
  private readonly locks: ResourceLockManager;

  constructor(private readonly options: { installationId: string; userId: string; usersRoot: string }) {
    if (!IDENTITY.test(options.installationId) || !IDENTITY.test(options.userId) || !path.isAbsolute(options.usersRoot)) {
      throw new Error("La identidad de las propuestas de automatización no es válida.");
    }
    this.root = path.join(path.resolve(options.usersRoot), options.userId, "automations");
    this.filePath = path.join(this.root, "chat-proposals.json");
    this.locks = new ResourceLockManager({ rootDirectory: path.join(this.root, "locks") });
  }

  private async prepare() {
    for (const directory of [this.root, path.join(this.root, "locks")]) {
      try {
        const metadata = await lstat(directory);
        if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
          throw new Error("El directorio de propuestas de automatización no es privado.");
        }
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
        await mkdir(directory, { recursive: true, mode: 0o700 });
      }
    }
  }

  private async read() {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) ||
          !Array.isArray((value as { proposals?: unknown }).proposals)) throw new Error("Automation proposals are corrupt.");
      const proposals = (value as { proposals: unknown[] }).proposals.map(parseProposal);
      if (proposals.some((proposal) => !proposal)) throw new Error("Automation proposals are corrupt.");
      return proposals as Proposal[];
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(proposals: Proposal[]) {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await atomicWriteFile(this.filePath, `${JSON.stringify({ schemaVersion: 1, proposals }, null, 2)}\n`, { mode: 0o600 });
  }

  async propose(input: AutomationTaskInput, binding: { sourceThreadId: string; sourceTurnId: string; callId: string }) {
    await this.prepare();
    return this.locks.withLock("automation-chat-proposals", async () => {
      const proposals = await this.read();
      const replay = proposals.find((item) => item.sourceTurnId === binding.sourceTurnId && item.callId === binding.callId);
      if (replay) return replay;
      const proposal: Proposal = {
        schemaVersion: 1, id: randomUUID(), taskId: randomUUID(),
        installationId: this.options.installationId, userId: this.options.userId,
        ...binding, input, status: "pending", createdAt: new Date().toISOString(), confirmedAt: null,
      };
      proposals.push(proposal);
      await this.write(proposals.slice(-200));
      return proposal;
    });
  }

  async confirm(proposalId: string, binding: { sourceThreadId: string; currentTurnId: string; currentMessage: string }, create: (proposal: Proposal) => Promise<void>) {
    await this.prepare();
    return this.locks.withLock("automation-chat-proposals", async () => {
      const proposals = await this.read();
      const proposal = proposals.find((item) => item.id === proposalId && item.installationId === this.options.installationId && item.userId === this.options.userId);
      if (!proposal || proposal.sourceThreadId !== binding.sourceThreadId) throw new Error("La propuesta de automatización no está disponible en esta conversación.");
      if (proposal.status === "confirmed") return proposal;
      if (proposal.sourceTurnId === binding.currentTurnId || !isExplicitAutomationConfirmation(binding.currentMessage)) {
        throw new Error("La automatización requiere una confirmación explícita en un mensaje posterior.");
      }
      await create(proposal);
      proposal.status = "confirmed";
      proposal.confirmedAt = new Date().toISOString();
      await this.write(proposals);
      return proposal;
    });
  }
}

export async function automationChatDeveloperInstructions(session: AuthSession) {
  const [{ directory }, workbench] = await Promise.all([
    import("@/automations/server-service").then(({ listAutomationTasks }) => listAutomationTasks(session)),
    loadWorkbench(session),
  ]);
  return [
    "## Creación de automatizaciones desde chat",
    "Si el usuario pide programar o automatizar trabajo, usa aibrain_automations.propose solo cuando estén claros acción, horario, zona horaria, proyecto o Sin proyecto y audiencia.",
    "Después presenta esos cinco campos y pide confirmación. No llames a confirm en el mismo turno. Solo confirma tras un mensaje posterior explícito del usuario.",
    "Cada ejecución tendrá búsqueda web activa y volverá a resolver las skills y conectores actualmente autorizados; una revocación hará que dejen de estar disponibles.",
    "BEGIN AIBRAIN AUTOMATION DIRECTORY JSON",
    JSON.stringify({
      projects: workbench.projects.filter((project) => project.status === "active").map((project) => ({ id: project.id, name: project.slug === STANDALONE_PROJECT_SLUG ? "Sin proyecto" : project.name })),
      audience: directory,
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
    parsed.audience = validateAutomationAudience(parsed.audience!, workspace);
    const proposal = await store.propose(parsed, { sourceThreadId: context.sourceThreadId, sourceTurnId: context.sourceTurnId, callId: params.callId });
    return success({ status: "pending-user-confirmation", proposalId: proposal.id, action: parsed.prompt, schedule: parsed.schedule, timeZone: parsed.timeZone, project: parsed.projectName, audience: parsed.audience, webSearch: "always", authorizedSkillsAndConnectors: "revalidated-on-every-run" });
  }
  if (params.tool === "confirm") {
    if (!strictObject(params.arguments, ["proposalId"]) || typeof (params.arguments as { proposalId?: unknown }).proposalId !== "string") throw new Error("La confirmación de automatización no es válida.");
    const proposal = await store.confirm((params.arguments as { proposalId: string }).proposalId, { sourceThreadId: context.sourceThreadId, currentTurnId: context.sourceTurnId, currentMessage: context.sourceMessage }, async (item) => {
      const project = await getProject(context.session, item.input.projectId);
      if (project.status !== "active") throw new Error("El proyecto ya no está disponible.");
      await createAutomationTask(context.session, { ...item.input, projectName: project.slug === STANDALONE_PROJECT_SLUG ? "Sin proyecto" : project.name }, { taskId: item.taskId });
    });
    return success({ status: "created", taskId: proposal.taskId, proposalId: proposal.id });
  }
  throw new Error("La herramienta de automatización no está permitida.");
}
