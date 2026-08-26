import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import type {
  ActivityItem,
  ApprovalDecision,
  ApprovalItem,
  ChatRequest,
  ChatStreamEvent,
  PlanStep,
} from "@/lib/chat-contract";
import { waitForApproval } from "@/runtime/approval-store";
import type { RuntimeConfig } from "@/runtime/config";
import { issueThreadToken } from "@/runtime/thread-token";
import type { RuntimeModelOption, RuntimeSkillOption } from "@/lib/runtime-status";

type RpcId = number | string;

type RpcMessage =
  | { kind: "result"; id: number; result: unknown }
  | { kind: "error"; id: number; message: string }
  | { kind: "notification"; method: string; params: unknown }
  | { kind: "serverRequest"; id: RpcId; method: string; params: unknown };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type ServerRequest = Extract<RpcMessage, { kind: "serverRequest" }>;
export type CodexTurnEvent = ChatStreamEvent | {
  type: "runtimeThread";
  threadToken: string;
};
type EmitEvent = (event: CodexTurnEvent) => void;

export type CodexConnection = {
  connected: boolean;
  authMode: "chatgpt" | "apiKey" | "amazonBedrock" | null;
  planType: string | null;
  models: RuntimeModelOption[];
  skills: RuntimeSkillOption[];
  webSearch: boolean;
  imageGeneration: boolean;
};

export class RuntimeNotReadyError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function parseRpcMessage(value: unknown): RpcMessage | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  const method = typeof value.method === "string" ? value.method : null;

  if (typeof id === "number" && "result" in value) {
    return { kind: "result", id, result: value.result };
  }

  if (typeof id === "number" && isRecord(value.error)) {
    return {
      kind: "error",
      id,
      message:
        typeof value.error.message === "string"
          ? value.error.message
          : "Codex ha retornat un error.",
    };
  }

  if ((typeof id === "number" || typeof id === "string") && method) {
    return {
      kind: "serverRequest",
      id,
      method,
      params: value.params,
    };
  }

  if (method) {
    return { kind: "notification", method, params: value.params };
  }

  return null;
}

function resolveCodexBinary(binary: string) {
  const candidates = path.isAbsolute(binary)
    ? [binary]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, binary));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      continue;
    }
  }

  return binary;
}

class AppServerSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closing = false;

  constructor(
    config: RuntimeConfig,
    private readonly onNotification: (method: string, params: unknown) => void,
    private readonly onServerRequest: (request: ServerRequest) => Promise<object>,
    private readonly onFailure: (error: Error) => void = () => undefined,
  ) {
    mkdirSync(config.workspace, { recursive: true, mode: 0o700 });
    if (config.codexHome) {
      mkdirSync(config.codexHome, { recursive: true, mode: 0o700 });
    }
    this.child = spawn(
      resolveCodexBinary(config.codexBinary),
      ["app-server", "--stdio"],
      {
        cwd: config.workspace,
        env: {
          ...process.env,
          ...(config.codexHome ? { CODEX_HOME: config.codexHome } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.receive(line));
    this.child.stderr.resume();
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code) => {
      if (!this.closing) {
        this.failAll(
          new Error(`Codex App Server s'ha tancat amb codi ${code ?? "desconegut"}.`),
        );
      }
    });
  }

  private receive(line: string) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      return;
    }

    const message = parseRpcMessage(decoded);
    if (!message) return;

    if (message.kind === "notification") {
      this.onNotification(message.method, message.params);
      return;
    }

    if (message.kind === "serverRequest") {
      void this.onServerRequest(message).then(
        (result) => this.write({ id: message.id, result }),
        (error: unknown) =>
          this.write({
            id: message.id,
            error: {
              code: -32603,
              message:
                error instanceof Error
                  ? error.message
                  : "No s'ha pogut resoldre la petició de Codex.",
            },
          }),
      );
      return;
    }

    const request = this.pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    this.pending.delete(message.id);

    if (message.kind === "error") request.reject(new Error(message.message));
    else request.resolve(message.result);
  }

  private write(message: object) {
    if (!this.child.stdin.destroyed) {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }

  private failAll(error: Error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
    this.onFailure(error);
  }

  notify(method: string, params: object) {
    this.write({ method, params });
  }

  request(method: string, params: object | undefined, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Temps d'espera excedit a ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.write({ method, id, ...(params === undefined ? {} : { params }) });
    });
  }

  close() {
    this.closing = true;
    this.lines.close();
    this.child.kill("SIGTERM");
  }
}

function extractThreadId(result: unknown) {
  if (!isRecord(result) || !isRecord(result.thread)) return null;
  return typeof result.thread.id === "string" ? result.thread.id : null;
}

function extractTurnId(result: unknown) {
  if (!isRecord(result) || !isRecord(result.turn)) return null;
  return typeof result.turn.id === "string" ? result.turn.id : null;
}

function parseAccount(result: unknown): CodexConnection {
  if (!isRecord(result) || !isRecord(result.account)) {
    return { connected: false, authMode: null, planType: null, models: [], skills: [], webSearch: false, imageGeneration: false };
  }

  const account = result.account;
  if (account.type === "chatgpt") {
    return {
      connected: true,
      authMode: "chatgpt",
      planType: typeof account.planType === "string" ? account.planType : null,
      models: [], skills: [], webSearch: false, imageGeneration: false,
    };
  }
  if (account.type === "apiKey") {
    return { connected: true, authMode: "apiKey", planType: null, models: [], skills: [], webSearch: false, imageGeneration: false };
  }
  if (account.type === "amazonBedrock") {
    return { connected: true, authMode: "amazonBedrock", planType: null, models: [], skills: [], webSearch: false, imageGeneration: false };
  }

  return { connected: false, authMode: null, planType: null, models: [], skills: [], webSearch: false, imageGeneration: false };
}

function parseModels(result: unknown): RuntimeModelOption[] {
  if (!isRecord(result) || !Array.isArray(result.data)) return [];
  return result.data.flatMap((model) => {
    if (!isRecord(model) || typeof model.model !== "string" || model.hidden === true) return [];
    const modalities = Array.isArray(model.inputModalities)
      ? model.inputModalities.filter((item): item is "text" | "image" | "audio" => item === "text" || item === "image" || item === "audio")
      : ["text" as const];
    return [{
      id: model.model,
      label: typeof model.displayName === "string" ? model.displayName : model.model,
      description: typeof model.description === "string" ? model.description : "Model disponible al runtime",
      isDefault: model.isDefault === true,
      inputModalities: modalities,
    }];
  }).slice(0, 24);
}

type ResolvedSkill = RuntimeSkillOption & { path: string };

function parseSkills(result: unknown): ResolvedSkill[] {
  if (!isRecord(result) || !Array.isArray(result.data)) return [];
  const resolved: ResolvedSkill[] = [];
  for (const entry of result.data) {
    if (!isRecord(entry) || !Array.isArray(entry.skills)) continue;
    for (const skill of entry.skills) {
      if (!isRecord(skill) || skill.enabled !== true || typeof skill.name !== "string" || typeof skill.path !== "string") continue;
      resolved.push({
        id: skill.name,
        label: isRecord(skill.interface) && typeof skill.interface.displayName === "string" ? skill.interface.displayName : skill.name,
        description: typeof skill.description === "string" ? skill.description : "Skill del workspace",
        path: skill.path,
      });
    }
  }
  return [...new Map(resolved.map((skill) => [skill.id, skill])).values()].slice(0, 80);
}

export async function checkCodexConnection(config: RuntimeConfig): Promise<CodexConnection> {
  const session = new AppServerSession(
    config,
    () => undefined,
    async () => {
      throw new Error("El healthcheck no admet peticions interactives.");
    },
  );

  try {
    await session.request("initialize", {
      clientInfo: {
        name: "aibrain_healthcheck",
        title: "AiBrain",
        version: "0.2.0",
      },
      capabilities: null,
    });
    session.notify("initialized", {});
    const account = await session.request(
      "account/read",
      { refreshToken: false },
      10_000,
    );
    const connection = parseAccount(account);
    const [modelsResult, skillsResult, capabilitiesResult] = await Promise.all([
      session.request("model/list", { limit: 30, includeHidden: false }, 10_000).catch(() => null),
      session.request("skills/list", { cwds: [config.workspace], forceReload: false }, 10_000).catch(() => null),
      session.request("modelProvider/capabilities/read", {}, 10_000).catch(() => null),
    ]);
    return {
      ...connection,
      models: parseModels(modelsResult),
      skills: parseSkills(skillsResult).map(({ path: _path, ...skill }) => skill),
      webSearch: isRecord(capabilitiesResult) && capabilitiesResult.webSearch === true,
      imageGeneration: isRecord(capabilitiesResult) && capabilitiesResult.imageGeneration === true,
    };
  } finally {
    session.close();
  }
}

function statusFromItem(value: unknown, completed: boolean): ActivityItem["status"] {
  if (value === "failed") return "failed";
  if (value === "declined") return "stopped";
  if (value === "completed" || completed) return "complete";
  return "running";
}

function joinedStrings(value: unknown) {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings.join("\n") : null;
}

function fileChangeSummary(changes: unknown) {
  if (!Array.isArray(changes)) return null;
  const paths = changes.flatMap((change) =>
    isRecord(change) && typeof change.path === "string" ? [change.path] : [],
  );
  return paths.length > 0 ? paths.join(", ") : null;
}

function itemActivity(params: unknown, completed: boolean): ActivityItem | null {
  if (!isRecord(params) || !isRecord(params.item)) return null;
  const item = params.item;
  if (typeof item.id !== "string" || typeof item.type !== "string") return null;

  const status = statusFromItem(item.status, completed);

  if (item.type === "commandExecution") {
    const command = typeof item.command === "string" ? item.command : "Ordre de terminal";
    return {
      id: item.id,
      kind: "command",
      label: status === "running" ? "Executant una ordre" : "Ordre executada",
      detail: command,
      ...(typeof item.aggregatedOutput === "string"
        ? { output: item.aggregatedOutput }
        : {}),
      status,
    };
  }

  if (item.type === "fileChange") {
    return {
      id: item.id,
      kind: "file",
      label: status === "running" ? "Preparant canvis" : "Canvis de fitxers",
      ...(fileChangeSummary(item.changes)
        ? { detail: fileChangeSummary(item.changes) ?? undefined }
        : {}),
      status,
    };
  }

  if (item.type === "mcpToolCall") {
    const server = typeof item.server === "string" ? item.server : "MCP";
    const tool = typeof item.tool === "string" ? item.tool : "eina";
    return {
      id: item.id,
      kind: "tool",
      label: status === "running" ? `Utilitzant ${tool}` : `${tool} completat`,
      detail: server,
      status,
    };
  }

  if (item.type === "dynamicToolCall") {
    const tool = typeof item.tool === "string" ? item.tool : "Eina";
    return {
      id: item.id,
      kind: "tool",
      label: status === "running" ? `Utilitzant ${tool}` : `${tool} completat`,
      ...(typeof item.namespace === "string" ? { detail: item.namespace } : {}),
      status,
    };
  }

  if (item.type === "webSearch") {
    return {
      id: item.id,
      kind: "web",
      label: status === "running" ? "Cercant al web" : "Cerca web completada",
      ...(typeof item.query === "string" ? { detail: item.query } : {}),
      status,
    };
  }

  if (item.type === "reasoning") {
    return {
      id: item.id,
      kind: "reasoning",
      label: status === "running" ? "Raonant" : "Raonament completat",
      ...(joinedStrings(item.summary) ? { detail: joinedStrings(item.summary) ?? undefined } : {}),
      status,
    };
  }

  if (item.type === "plan") {
    return {
      id: item.id,
      kind: "plan",
      label: status === "running" ? "Preparant el pla" : "Pla preparat",
      ...(typeof item.text === "string" ? { detail: item.text } : {}),
      status,
    };
  }

  if (item.type === "collabAgentToolCall" || item.type === "subAgentActivity") {
    return {
      id: item.id,
      kind: "agent",
      label: status === "running" ? "Coordinant agents" : "Coordinació completada",
      ...(typeof item.tool === "string" ? { detail: item.tool } : {}),
      status,
    };
  }

  return null;
}

function notificationDelta(params: unknown) {
  return isRecord(params) && typeof params.delta === "string" ? params.delta : null;
}

function notificationItemId(params: unknown) {
  return isRecord(params) && typeof params.itemId === "string" ? params.itemId : null;
}

function planFromNotification(params: unknown): {
  explanation: string | null;
  steps: PlanStep[];
} | null {
  if (!isRecord(params) || !Array.isArray(params.plan)) return null;

  const steps: PlanStep[] = [];
  for (const value of params.plan) {
    if (!isRecord(value) || typeof value.step !== "string") continue;
    if (value.status === "pending" || value.status === "completed") {
      steps.push({ step: value.step, status: value.status });
    } else if (value.status === "inProgress") {
      steps.push({ step: value.step, status: "in_progress" });
    }
  }

  return {
    explanation: typeof params.explanation === "string" ? params.explanation : null,
    steps,
  };
}

function completedTurnStatus(params: unknown) {
  if (!isRecord(params) || !isRecord(params.turn)) return null;
  const turn = params.turn;
  const error = isRecord(turn.error) ? turn.error : null;
  return {
    status: typeof turn.status === "string" ? turn.status : null,
    error: error && typeof error.message === "string" ? error.message : null,
  };
}

type PendingServerApproval = {
  item: ApprovalItem;
  response: (decision: ApprovalDecision | "cancel") => object;
};

function permissionGrant(value: unknown) {
  if (!isRecord(value)) return {};
  const grant: Record<string, unknown> = {};
  if (value.network !== null && value.network !== undefined) {
    grant.network = value.network;
  }
  if (value.fileSystem !== null && value.fileSystem !== undefined) {
    grant.fileSystem = value.fileSystem;
  }
  return grant;
}

function permissionSummary(value: unknown) {
  if (!isRecord(value)) return null;
  const parts: string[] = [];
  if (isRecord(value.fileSystem)) {
    const read = joinedStrings(value.fileSystem.read);
    const write = joinedStrings(value.fileSystem.write);
    if (read) parts.push(`Lectura: ${read}`);
    if (write) parts.push(`Escriptura: ${write}`);
  }
  if (isRecord(value.network) && value.network.enabled === true) {
    parts.push("Accés de xarxa");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function approvalFromRequest(request: ServerRequest): PendingServerApproval | null {
  if (!isRecord(request.params)) return null;
  const params = request.params;
  const reason = typeof params.reason === "string" ? params.reason : null;

  if (request.method === "item/commandExecution/requestApproval") {
    const command = typeof params.command === "string" ? params.command : null;
    return {
      item: {
        id: randomUUID(),
        kind: "command",
        title: "Codex vol executar una ordre",
        detail: reason ?? command ?? "Revisa l’ordre abans de continuar.",
        ...(command ? { command } : {}),
        ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}),
        status: "pending",
      },
      response: (decision) => ({ decision }),
    };
  }

  if (request.method === "item/fileChange/requestApproval") {
    return {
      item: {
        id: randomUUID(),
        kind: "file",
        title: "Codex vol modificar fitxers",
        detail: reason ?? "Revisa els canvis abans de continuar.",
        status: "pending",
      },
      response: (decision) => ({ decision }),
    };
  }

  if (request.method === "item/permissions/requestApproval") {
    const requested = isRecord(params.permissions) ? params.permissions : {};
    return {
      item: {
        id: randomUUID(),
        kind: "command",
        title: "Codex demana permisos addicionals",
        detail:
          reason ??
          permissionSummary(requested) ??
          "Revisa els permisos abans de continuar.",
        ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}),
        status: "pending",
      },
      response: (decision) => ({
        permissions:
          decision === "decline" || decision === "cancel"
            ? {}
            : permissionGrant(requested),
        scope: decision === "acceptForSession" ? "session" : "turn",
      }),
    };
  }

  return null;
}

function resolvedApproval(
  approval: ApprovalItem,
  decision: ApprovalDecision | "cancel",
): ApprovalItem {
  const status =
    decision === "accept"
      ? "accepted"
      : decision === "acceptForSession"
        ? "accepted_session"
        : "declined";
  return { ...approval, status };
}

function effectiveSandbox(config: RuntimeConfig, chatRequest: ChatRequest) {
  return chatRequest.options.mode === "agent" ? config.sandbox : "read-only";
}

function sandboxPolicy(config: RuntimeConfig, chatRequest: ChatRequest) {
  if (effectiveSandbox(config, chatRequest) === "read-only") {
    return { type: "readOnly" as const, networkAccess: true };
  }
  return {
    type: "workspaceWrite" as const,
    writableRoots: [config.workspace],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function developerInstructions(chatRequest: ChatRequest) {
  const toneInstruction = {
    direct: "Sigues breu i prioritza la conclusió.",
    balanced: "Equilibra la conclusió amb el context necessari.",
    detailed: "Explica el raonament útil i els matisos de forma estructurada.",
  }[chatRequest.preferences.tone];

  const modeInstruction = {
    agent: "Completa la tasca i fes canvis verificables quan siguin necessaris.",
    plan: "No modifiquis fitxers. Investiga el context i lliura un pla executable amb riscos i verificació.",
    ask: "No modifiquis fitxers. Respon la pregunta amb evidència del workspace quan sigui útil.",
  }[chatRequest.options.mode];
  const imageInstruction = chatRequest.options.imageGeneration
    ? "Genera una imatge amb l’eina d’imatge del runtime i retorna-la com a resultat del torn."
    : "No generis imatges tret que l’usuari ho demani explícitament.";

  return `Ets AiBrain, una interfície pròpia construïda sobre el runtime de Codex.
Respon en l'idioma de l'usuari amb un estil clar, directe i verificable.
${toneInstruction}
${modeInstruction}
${imageInstruction}
Treballa només dins del workspace configurat i utilitza les eines de Codex quan aportin evidència o siguin necessàries per completar la tasca.
No afirmis que una acció, una font o una integració funciona si no l'has observat.
Quan una acció necessiti aprovació, explica de forma concreta què vols fer i per què.`;
}

export async function runCodexTurn(
  chatRequest: ChatRequest,
  tenantId: string,
  runtimeThreadId: string | null,
  config: RuntimeConfig,
  signal: AbortSignal,
  emit: EmitEvent,
) {
  if (config.mode !== "codex") {
    throw new RuntimeNotReadyError("El runtime real de Codex no està activat.");
  }
  if (process.env.NODE_ENV === "production" && !config.codexHome) {
    throw new RuntimeNotReadyError(
      "Producció requereix un CODEX_HOME aïllat i persistent.",
    );
  }

  let turnId: string | null = null;
  let threadId: string | null = null;
  let turnTimeout: ReturnType<typeof setTimeout> | null = null;
  let finishTurn:
    | ((status: { status: string | null; error: string | null }) => void)
    | null = null;
  const turnFinished = new Promise<{ status: string | null; error: string | null }>(
    (resolve) => {
      finishTurn = resolve;
    },
  );
  const activities = new Map<string, ActivityItem>();

  const upsertActivity = (item: ActivityItem) => {
    activities.set(item.id, item);
    if (chatRequest.preferences.showActivity) emit({ type: "activity", item });
  };

  const session = new AppServerSession(
    config,
    (method, params) => {
      if (method === "item/agentMessage/delta") {
        const delta = notificationDelta(params);
        if (delta) emit({ type: "delta", value: delta });
        return;
      }

      if (method === "item/started" || method === "item/completed") {
        if (method === "item/completed" && isRecord(params) && isRecord(params.item) && params.item.type === "imageGeneration") {
          const item = params.item;
          if (typeof item.result === "string" && item.result.length > 0) {
            const encoded = item.result.includes(",") ? item.result.slice(item.result.indexOf(",") + 1) : item.result;
            const bytes = Buffer.from(encoded, "base64");
            if (bytes.length > 0 && bytes.length <= 20_000_000) {
              const artifactId = randomUUID();
              const directory = path.join(config.workspace, ".aibrain", "artifacts");
              mkdirSync(directory, { recursive: true, mode: 0o700 });
              writeFileSync(path.join(directory, `${artifactId}.png`), bytes, { mode: 0o600 });
              emit({
                type: "artifact",
                item: {
                  id: artifactId,
                  type: "image",
                  name: `imatge-${artifactId.slice(0, 8)}.png`,
                  url: `/api/projects/${chatRequest.projectId}/artifacts/${artifactId}`,
                  prompt: typeof item.revisedPrompt === "string" ? item.revisedPrompt : null,
                },
              });
            }
          }
        }
        const activity = itemActivity(params, method === "item/completed");
        if (activity) upsertActivity(activity);
        return;
      }

      if (method === "item/commandExecution/outputDelta") {
        const itemId = notificationItemId(params);
        const delta = notificationDelta(params);
        if (!itemId || !delta) return;
        const current = activities.get(itemId) ?? {
          id: itemId,
          kind: "command",
          label: "Executant una ordre",
          status: "running",
        } satisfies ActivityItem;
        upsertActivity({ ...current, output: `${current.output ?? ""}${delta}` });
        return;
      }

      if (method === "item/reasoning/summaryTextDelta") {
        const itemId = notificationItemId(params);
        const delta = notificationDelta(params);
        if (!itemId || !delta) return;
        const current = activities.get(itemId) ?? {
          id: itemId,
          kind: "reasoning",
          label: "Raonant",
          status: "running",
        } satisfies ActivityItem;
        upsertActivity({ ...current, detail: `${current.detail ?? ""}${delta}` });
        return;
      }

      if (method === "turn/plan/updated") {
        const plan = planFromNotification(params);
        if (plan) emit({ type: "plan", ...plan });
        return;
      }

      if (method === "turn/diff/updated") {
        if (isRecord(params) && typeof params.diff === "string") {
          emit({ type: "diff", value: params.diff });
        }
        return;
      }

      if (method === "warning" || method === "error") {
        if (!isRecord(params)) return;
        const message =
          typeof params.message === "string"
            ? params.message
            : typeof params.error === "string"
              ? params.error
              : null;
        if (message) {
          upsertActivity({
            id: `runtime-${randomUUID()}`,
            kind: "system",
            label: method === "error" ? "Error del runtime" : "Avís del runtime",
            detail: message,
            status: method === "error" ? "failed" : "complete",
          });
        }
        return;
      }

      if (method === "turn/completed") {
        finishTurn?.(
          completedTurnStatus(params) ?? {
            status: null,
            error: "Resposta incompleta de Codex.",
          },
        );
      }
    },
    async (request) => {
      const approval = approvalFromRequest(request);
      if (!approval) {
        throw new Error(`AiBrain encara no admet ${request.method}.`);
      }

      emit({ type: "approval", item: approval.item });
      const decision = await waitForApproval(tenantId, approval.item, signal);
      emit({ type: "approval", item: resolvedApproval(approval.item, decision) });
      return approval.response(decision);
    },
    (error) => finishTurn?.({ status: "failed", error: error.message }),
  );

  const interrupt = () => {
    if (threadId && turnId) {
      void session
        .request("turn/interrupt", { threadId, turnId }, 5_000)
        .catch(() => undefined);
    }
    finishTurn?.({ status: "interrupted", error: null });
  };
  signal.addEventListener("abort", interrupt, { once: true });

  try {
    await session.request("initialize", {
      clientInfo: {
        name: "aibrain_workbench",
        title: "AiBrain",
        version: "0.2.0",
      },
      capabilities: null,
    });
    session.notify("initialized", {});

    const account = parseAccount(
      await session.request("account/read", { refreshToken: false }, 10_000),
    );
    if (!account.connected) {
      throw new RuntimeNotReadyError("Cal connectar un compte de Codex.");
    }

    upsertActivity({
      id: "codex-connected",
      kind: "system",
      label: "Codex connectat",
      detail: account.planType ? `Pla ${account.planType}` : "Sessió verificada",
      status: "complete",
    });

    let selectedModel = config.model;
    let selectedModelOption: RuntimeModelOption | null = null;
    if (chatRequest.options.model) {
      const catalog = parseModels(await session.request("model/list", { limit: 50, includeHidden: false }, 10_000));
      selectedModelOption = catalog.find((model) => model.id === chatRequest.options.model) ?? null;
      if (!selectedModelOption) {
        throw new Error("El model seleccionat ja no està disponible.");
      }
      selectedModel = chatRequest.options.model;
    }
    if (selectedModelOption && chatRequest.options.attachments.length > 0 && !selectedModelOption.inputModalities.includes("image")) {
      throw new Error("El model seleccionat no admet imatges.");
    }
    if (chatRequest.options.webSearch) {
      const capabilities = await session.request("modelProvider/capabilities/read", {}, 10_000);
      if (!isRecord(capabilities) || capabilities.webSearch !== true) {
        throw new Error("La cerca web no està disponible en aquest runtime.");
      }
    }
    if (chatRequest.options.imageGeneration) {
      const capabilities = await session.request("modelProvider/capabilities/read", {}, 10_000);
      if (!isRecord(capabilities) || capabilities.imageGeneration !== true) {
        throw new Error("La generació d’imatges no està disponible en aquest runtime.");
      }
    }
    let selectedSkill: ResolvedSkill | null = null;
    if (chatRequest.options.skill) {
      const catalog = parseSkills(await session.request("skills/list", { cwds: [config.workspace], forceReload: false }, 10_000));
      selectedSkill = catalog.find((skill) => skill.id === chatRequest.options.skill) ?? null;
      if (!selectedSkill) throw new Error("La skill seleccionada ja no està disponible.");
    }

    const commonThreadParams = {
      ...(selectedModel ? { model: selectedModel } : {}),
      cwd: config.workspace,
      approvalPolicy: config.approvalPolicy,
      approvalsReviewer: "user",
      sandbox: effectiveSandbox(config, chatRequest),
      config: { web_search: chatRequest.options.webSearch ? "live" : "disabled" },
      developerInstructions: developerInstructions(chatRequest),
    };

    const threadResult = runtimeThreadId
      ? await session.request("thread/resume", {
          threadId: runtimeThreadId,
          ...commonThreadParams,
        })
      : await session.request(
          "thread/start",
          {
            ...commonThreadParams,
            ephemeral: false,
            serviceName: "aibrain_workbench",
          },
          60_000,
        );

    threadId = extractThreadId(threadResult);
    if (!threadId) throw new Error("Codex no ha retornat cap thread vàlid.");
    emit({ type: "runtimeThread", threadToken: issueThreadToken(tenantId, threadId) });

    const turnResult = await session.request(
      "turn/start",
      {
        threadId,
        input: [
          { type: "text", text: chatRequest.message, text_elements: [] },
          ...(selectedSkill ? [{ type: "skill" as const, name: selectedSkill.id, path: selectedSkill.path }] : []),
          ...chatRequest.options.attachments.map((attachment) => ({ type: "image" as const, url: attachment.dataUrl })),
        ],
        cwd: config.workspace,
        approvalPolicy: config.approvalPolicy,
        approvalsReviewer: "user",
        sandboxPolicy: sandboxPolicy(config, chatRequest),
        ...(selectedModel ? { model: selectedModel } : {}),
      },
      60_000,
    );
    turnId = extractTurnId(turnResult);
    if (!turnId) throw new Error("Codex no ha iniciat el torn.");

    turnTimeout = setTimeout(() => {
      finishTurn?.({ status: "failed", error: "El torn de Codex ha excedit cinc minuts." });
    }, 300_000);
    const completed = await turnFinished;
    clearTimeout(turnTimeout);
    turnTimeout = null;

    if (completed.status === "failed") {
      throw new Error(completed.error ?? "El torn de Codex ha fallat.");
    }
    if (completed.status === "interrupted" || signal.aborted) return;
    emit({ type: "done" });
  } finally {
    if (turnTimeout) clearTimeout(turnTimeout);
    signal.removeEventListener("abort", interrupt);
    session.close();
  }
}
