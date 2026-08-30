import { chmod, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicToolCallParams } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallParams";
import type { ApprovalItem } from "@/lib/chat-contract";
import type { ResolvedPermissions } from "@/permissions";
import {
  FileApprovalStore,
  approvalLocatorFromItem,
} from "@/runtime/approval-store";
import {
  AIBRAIN_BROWSER_TOOL_NAMESPACE,
  BROWSER_DYNAMIC_TOOLS,
  handleBrowserDynamicToolCall,
} from "@/runtime/browser/dynamic-tools";
import { BrowserToolCallStore } from "@/runtime/browser/tool-call-store";
import { browserEvidenceHash } from "@/runtime/browser/action-evidence";
import type {
  BrowserActionResourceSnapshot,
  BrowserInformedApprovalEvidence,
} from "@/runtime/browser/action-evidence";
import type { BrowserAgentCommand } from "@/runtime/browser/server-service";
import { assertCodexClientRequest } from "@/runtime/transport/codex-contract-validation";

const INSTALLATION_ID = "browser-tools-test";
const USER_ID = "11a11111-1111-4111-8111-111111111111";
const BROWSER_THREAD_A = "11a11111-1111-4111-8111-111111111121";
const BROWSER_THREAD_B = "11a11111-1111-4111-8111-111111111122";
const FINGERPRINT = "a".repeat(64);
const STORAGE_WAIT_OPTIONS = { timeout: 10_000, interval: 50 } as const;

type ExecutedBrowserCommand = {
  installationId: string;
  userId: string;
  threadId: string;
  command: BrowserAgentCommand;
  approvalEvidence?: BrowserInformedApprovalEvidence;
  expectedResource?: BrowserActionResourceSnapshot;
  signal?: AbortSignal;
};

function permissions(allowed = true): ResolvedPermissions {
  return {
    schemaVersion: 1,
    installationId: INSTALLATION_ID,
    userId: USER_ID,
    roleId: null,
    projectId: null,
    turnId: "local-turn",
    resolvedAt: "2026-08-27T00:00:00.000Z",
    fingerprint: FINGERPRINT,
    sources: [],
    rules: [{
      ruleId: "tools.execute",
      action: "execute",
      effect: allowed ? "allow" : "deny",
      instruction: "Synthetic browser tool permission.",
      sourceScope: "installation",
      sourcePolicyVersion: 1,
      precedence: 100,
    }],
    developerInstructions: `Policy fingerprint: ${FINGERPRINT}`,
  };
}

function browserPermissions(rules: ResolvedPermissions["rules"]): ResolvedPermissions {
  return { ...permissions(), rules };
}

function request(
  tool: string,
  argumentsValue: unknown,
  overrides: Partial<DynamicToolCallParams> = {},
): DynamicToolCallParams {
  return {
    threadId: "runtime-thread-a",
    turnId: "runtime-turn-a",
    callId: `call-${tool}`,
    namespace: AIBRAIN_BROWSER_TOOL_NAMESPACE,
    tool,
    arguments: argumentsValue as never,
    ...overrides,
  };
}

describe("closed browser dynamic tools", () => {
  const roots: string[] = [];

  beforeEach(() => vi.stubEnv("AIBRAIN_BROWSER_INTERACTIVE_APPROVALS", "enabled"));

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-browser-tools-"));
    roots.push(root);
    const usersRoot = path.join(root, "users");
    const userRoot = path.join(usersRoot, USER_ID);
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await chmod(usersRoot, 0o700);
    await chmod(userRoot, 0o700);
    const approvalStore = new FileApprovalStore({
      installationId: INSTALLATION_ID,
      userId: USER_ID,
      usersRoot,
    });
    return { root, usersRoot, userRoot, approvalStore };
  }

  function context(
    approvalStore: FileApprovalStore,
    execute: Parameters<typeof handleBrowserDynamicToolCall>[1]["execute"],
    emitted: ApprovalItem[],
    overrides: Partial<Omit<Parameters<typeof handleBrowserDynamicToolCall>[1], "execute">> = {},
  ): Parameters<typeof handleBrowserDynamicToolCall>[1] {
    return {
      installationId: INSTALLATION_ID,
      userId: USER_ID,
      runtimeThreadId: "runtime-thread-a",
      runtimeTurnId: "runtime-turn-a",
      browserThreadId: BROWSER_THREAD_A,
      permissions: permissions(),
      approvalStore,
      signal: new AbortController().signal,
      emitApproval: async (item) => { emitted.push(item); },
      prepare: vi.fn(async ({ threadId, command }) => ({
        kind: "browser-page" as const,
        origin: command.action === "open" ? new URL(command.url).origin : "https://example.test",
        sanitizedUrl: command.action === "open"
          ? `${new URL(command.url).origin}${new URL(command.url).pathname}`
          : "https://example.test/current",
        scopeId: threadId,
        generation: 3,
        version: browserEvidenceHash({ threadId, version: 3 }),
        locatorHash: browserEvidenceHash({ command: command.action, selector: "selector" }),
        locatorSummary: command.action === "click" || command.action === "type"
          ? `${command.selector} · button role=button · Submit`
          : `${command.action} https://example.test/current`,
      })),
      ...overrides,
      execute,
    };
  }

  it("matches the pinned ThreadStartParams contract with one closed browser namespace", () => {
    expect(() => assertCodexClientRequest({
      method: "thread/start",
      id: "browser-contract",
      params: { dynamicTools: [...BROWSER_DYNAMIC_TOOLS] },
    })).not.toThrow();
    expect(BROWSER_DYNAMIC_TOOLS).toHaveLength(1);
    expect(BROWSER_DYNAMIC_TOOLS[0]).toMatchObject({
      type: "namespace",
      name: "aibrain_browser",
    });
    expect((BROWSER_DYNAMIC_TOOLS[0] as { tools: Array<{ name: string }> }).tools.map(({ name }) => name))
      .toEqual(["open", "read", "screenshot", "scroll", "click", "type", "tabs", "downloads"]);
    expect(BROWSER_DYNAMIC_TOOLS[0]?.description).toContain("without interactive approval");
  });

  it("runs permissioned reads without approval and returns the durable cached result on replay", async () => {
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({ userRoot });
    const execute = vi.fn(async () => ({
      schemaVersion: 1,
      url: "https://example.test/",
      title: "Example",
      text: "Untrusted page text",
      links: [{ text: "Story", href: "https://example.test/story", selector: "a[data-aibrain-link=story]" }],
    }));
    const emitted: ApprovalItem[] = [];
    const input = request("read", {});
    const first = await handleBrowserDynamicToolCall(input, context(approvalStore, execute, emitted, { callStore }));
    const replay = await handleBrowserDynamicToolCall(input, context(approvalStore, execute, emitted, { callStore }));
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ success: true });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      threadId: BROWSER_THREAD_A,
      command: { action: "read" },
    }));
    expect(emitted).toEqual([]);
    const audit = await callStore.readAudit();
    expect(audit.map(({ payload }) => payload.status)).toEqual(["reserved", "executing", "completed"]);
    const serializedAudit = JSON.stringify(audit);
    expect(serializedAudit).not.toContain("example.test");
    expect(serializedAudit).not.toContain("Untrusted page text");
    expect(serializedAudit).toContain(FINGERPRINT);
  });

  it("opens, scrolls, navigates by click and types ordinary text without approval", async () => {
    const { approvalStore } = await fixture();
    const execute = vi.fn(async ({ command }: ExecutedBrowserCommand) => ({ action: command.action }));
    const emitted: ApprovalItem[] = [];
    const prepare = vi.fn(async ({ threadId, command }: {
      threadId: string;
      command: BrowserAgentCommand;
    }) => ({
      kind: "browser-page" as const,
      origin: command.action === "open" ? new URL(command.url).origin : "https://example.test",
      sanitizedUrl: command.action === "open"
        ? `${new URL(command.url).origin}${new URL(command.url).pathname}`
        : "https://example.test/current",
      scopeId: threadId,
      generation: 3,
      version: browserEvidenceHash({ threadId, version: 3 }),
      locatorHash: browserEvidenceHash({ action: command.action }),
      locatorSummary: command.action === "click"
        ? "a[data-aibrain-link=story] · a · Story"
        : command.action === "type"
          ? "input[name=q] · input · Search"
          : `${command.action} https://example.test/current`,
    }));
    const calls = [
      request("open", { url: "https://example.test/story" }, { callId: "routine-open" }),
      request("scroll", { deltaX: 0, deltaY: 600 }, { callId: "routine-scroll" }),
      request("click", { selector: "a[data-aibrain-link=story]" }, { callId: "routine-click" }),
      request("type", { selector: "input[name=q]", text: "RN Sport", clear: true }, { callId: "routine-type" }),
    ];
    for (const input of calls) {
      await expect(handleBrowserDynamicToolCall(
        input,
        context(approvalStore, execute, emitted, { prepare: prepare as never }),
      )).resolves.toMatchObject({ success: true });
    }
    expect(emitted).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls.every(([input]) => Boolean(!input.approvalEvidence && input.expectedResource))).toBe(true);
  });

  it("executes sensitive-looking employee interactions without any pending approval when product policy disables prompts", async () => {
    vi.stubEnv("AIBRAIN_BROWSER_INTERACTIVE_APPROVALS", "disabled");
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({ userRoot });
    const execute = vi.fn(async ({ command }: ExecutedBrowserCommand) => ({ action: command.action }));
    const emitted: ApprovalItem[] = [];
    for (const input of [
      request("click", { selector: "button[type=submit]" }, { callId: "no-prompt-click" }),
      request("type", { selector: "input[name=password]", text: "not-persisted", clear: true }, { callId: "no-prompt-type" }),
    ]) {
      await expect(handleBrowserDynamicToolCall(
        input,
        context(approvalStore, execute, emitted, { callStore }),
      )).resolves.toMatchObject({ success: true });
    }
    expect(emitted).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every(([input]) => Boolean(!input.approvalEvidence && input.expectedResource))).toBe(true);
    expect((await callStore.readAudit()).map(({ payload }) => payload.status)).toEqual([
      "reserved", "executing", "completed", "reserved", "executing", "completed",
    ]);
  });

  it("persists explicit sensitive-effect approval without blocking a different turn", async () => {
    const { approvalStore } = await fixture();
    const execute = vi.fn(async ({ command }: { command: { action: string } }) => ({ action: command.action }));
    const emitted: ApprovalItem[] = [];
    let durableAtEmission = false;
    const pending = handleBrowserDynamicToolCall(
      request("click", { selector: "button[type=submit]" }),
      context(approvalStore, execute, emitted, {
        emitApproval: async (item) => {
          if (item.status === "pending") {
            durableAtEmission = (await approvalStore.read(
              approvalLocatorFromItem(INSTALLATION_ID, USER_ID, item),
            ))?.status === "pending";
          }
          emitted.push(item);
        },
      }),
    );
    await vi.waitFor(
      () => expect(emitted.find((item) => item.status === "pending")).toBeDefined(),
      STORAGE_WAIT_OPTIONS,
    );
    const approval = emitted.find((item) => item.status === "pending") as ApprovalItem;
    expect(approval).toMatchObject({
      kind: "browser",
      permissionFingerprint: FINGERPRINT,
      threadId: "runtime-thread-a",
      turnId: "runtime-turn-a",
      itemId: "call-click",
    });
    expect(durableAtEmission).toBe(true);

    const otherExecute = vi.fn(async () => ({ schemaVersion: 1, url: "about:blank", title: "", text: "", links: [] }));
    const other = await handleBrowserDynamicToolCall(
      request("read", {}, {
        threadId: "runtime-thread-b",
        turnId: "runtime-turn-b",
        callId: "call-read-b",
      }),
      context(approvalStore, otherExecute, [], {
        runtimeThreadId: "runtime-thread-b",
        runtimeTurnId: "runtime-turn-b",
        browserThreadId: BROWSER_THREAD_B,
      }),
    );
    expect(other.success).toBe(true);
    expect(execute).not.toHaveBeenCalled();

    await approvalStore.resolve(
      approvalLocatorFromItem(INSTALLATION_ID, USER_ID, approval),
      "accept",
    );
    await expect(pending).resolves.toMatchObject({ success: true });
    expect(execute).toHaveBeenCalledOnce();
    expect(emitted.at(-1)?.status).toBe("accepted");
  });

  it("binds approval, mutation and applied readback to one non-secret evidence fingerprint", async () => {
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({ userRoot });
    const emitted: ApprovalItem[] = [];
    const execute = vi.fn(async (input: ExecutedBrowserCommand) => ({
      schemaVersion: 1,
      outcome: "applied",
      actionKind: input.command.action,
      evidenceFingerprint: input.approvalEvidence?.evidenceFingerprint,
      resource: input.expectedResource,
      observedAt: "2026-08-28T00:00:00.000Z",
    }));
    const response = await handleBrowserDynamicToolCall(
      request("type", { selector: "input[name=password]", text: "never-log-this", clear: true }),
      context(approvalStore, execute, emitted, {
        callStore,
        emitApproval: async (item) => {
          emitted.push(item);
          if (item.status === "pending") {
            await approvalStore.resolve(approvalLocatorFromItem(INSTALLATION_ID, USER_ID, item), "accept");
          }
        },
      }),
    );
    expect(response).toMatchObject({ success: true });
    const execution = execute.mock.calls[0]?.[0];
    if (!execution?.approvalEvidence) throw new Error("Expected approval evidence.");
    const evidence = execution.approvalEvidence;
    expect(execution?.approvalEvidence).toMatchObject({
      installationId: INSTALLATION_ID,
      userId: USER_ID,
      threadId: "runtime-thread-a",
      turnId: "runtime-turn-a",
      callId: "call-type",
      actionKind: "type",
      permissionFingerprint: FINGERPRINT,
      request: { secretInput: true },
      evidenceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(evidence.request.summary).toContain("input length=14");
    expect(evidence.request.summary).not.toContain("never-log-this");
    expect(execution?.expectedResource).toMatchObject({ scopeId: BROWSER_THREAD_A });
    expect(emitted[0]).toMatchObject({ id: `browser:${evidence.evidenceFingerprint.slice(0, 32)}` });
    expect(JSON.stringify(emitted)).not.toContain("never-log-this");
    const audit = await callStore.readAudit();
    expect(audit.map(({ payload }) => payload.status)).toEqual([
      "reserved", "approval_requested", "approval_resolved", "executing", "completed",
    ]);
    expect(audit.at(-1)?.payload).toMatchObject({
      evidenceFingerprint: evidence.evidenceFingerprint,
      success: true,
    });
  });

  it("rejects session-wide browser mutation approvals and never executes them", async () => {
    const { approvalStore } = await fixture();
    const execute = vi.fn();
    const emitted: ApprovalItem[] = [];
    const response = await handleBrowserDynamicToolCall(
      request("click", { selector: "button[type=submit]" }),
      context(approvalStore, execute, emitted, {
        emitApproval: async (item) => {
          emitted.push(item);
          if (item.status === "pending") {
            await approvalStore.resolve(approvalLocatorFromItem(INSTALLATION_ID, USER_ID, item), "acceptForSession");
          }
        },
      }),
    );
    expect(response).toMatchObject({ success: false });
    expect(response.contentItems[0]).toMatchObject({ text: expect.stringContaining("fresh one-action approval") });
    expect(execute).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toMatchObject({ status: "declined" });
  });

  it("recovers an aibrain_browser dynamic tool request failure without replaying dispatch", async () => {
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({ userRoot });
    const execute = vi.fn(async (_input: ExecutedBrowserCommand) => {
      throw new Error("aibrain_browser dynamic tool request failed");
    });
    const emitted: ApprovalItem[] = [];
    const input = request("scroll", { deltaX: 0, deltaY: 600 }, { callId: "runtime-failed-scroll" });
    const ctx = context(approvalStore, execute, emitted, {
      callStore,
    });
    const first = await handleBrowserDynamicToolCall(input, ctx);
    const replay = await handleBrowserDynamicToolCall(input, ctx);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ success: false });
    expect(first.contentItems[0]).toMatchObject({ text: expect.stringContaining("indeterminate") });
    expect(emitted).toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].signal).toBe(ctx.signal);
    const audit = await callStore.readAudit();
    expect(audit.map(({ payload }) => payload.status)).toEqual([
      "reserved", "executing", "indeterminate",
    ]);
    expect(audit.at(-1)?.payload.success).toBe(false);
  });

  it("returns a normal tool failure when the browser reconnects before dispatch", async () => {
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({ userRoot });
    const execute = vi.fn();
    const prepare = vi.fn(async () => {
      const error = new Error("Chrome closed the CDP response pipe") as Error & { code: string };
      error.code = "CDP_PIPE_EOF";
      throw error;
    });
    const input = request("open", { url: "https://example.test/reconnect" });
    const ctx = context(approvalStore, execute, [], { callStore, prepare });
    const first = await handleBrowserDynamicToolCall(input, ctx);
    const replay = await handleBrowserDynamicToolCall(input, ctx);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ success: false });
    expect(first.contentItems[0]).toMatchObject({ text: expect.stringContaining("before the action was dispatched") });
    expect(prepare).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps a typed secret out of the response, record and audit when post-dispatch readback fails", async () => {
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({ userRoot });
    const secret = "never-persist-this";
    const execute = vi.fn(async () => {
      const error = new Error("readback unavailable after Input.insertText") as Error & { code: string };
      error.code = "CHROME_ACTION_READBACK_UNAVAILABLE";
      throw error;
    });
    const response = await handleBrowserDynamicToolCall(
      request("type", { selector: "input[name=password]", text: secret, clear: true }),
      context(approvalStore, execute, [], {
        callStore,
        emitApproval: async (item) => {
          if (item.status === "pending") {
            await approvalStore.resolve(approvalLocatorFromItem(INSTALLATION_ID, USER_ID, item), "accept");
          }
        },
      }),
    );
    expect(response).toMatchObject({ success: false });
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(JSON.stringify(await callStore.readAudit())).not.toContain(secret);
    const records = (await readdir(callStore.recordsRoot)).filter((name) => name.endsWith(".json"));
    expect(records).toHaveLength(1);
    expect(await readFile(path.join(callStore.recordsRoot, records[0] as string), "utf8")).not.toContain(secret);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not duplicate a pending approval or execute twice when the same call is replayed", async () => {
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({ userRoot });
    const execute = vi.fn(async () => ({ ok: true }));
    const emitted: ApprovalItem[] = [];
    const input = request("click", { selector: "button[type=submit]" });
    const delivered = new Set<string>();
    const ctx = context(approvalStore, execute, emitted, {
      callStore,
      emitApproval: async (item) => {
        const key = `${item.id}:${item.status}`;
        if (delivered.has(key)) return;
        delivered.add(key);
        emitted.push(item);
      },
    });
    const first = handleBrowserDynamicToolCall(input, ctx);
    await vi.waitFor(
      () => expect(emitted.filter((item) => item.status === "pending")).toHaveLength(1),
      STORAGE_WAIT_OPTIONS,
    );
    const second = handleBrowserDynamicToolCall(input, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(emitted.filter((item) => item.status === "pending")).toHaveLength(1);
    const approval = emitted.find((item) => item.status === "pending") as ApprovalItem;
    await approvalStore.resolve(
      approvalLocatorFromItem(INSTALLATION_ID, USER_ID, approval),
      "accept",
    );
    const responses = await Promise.all([first, second]);
    expect(responses.some((response) => response.success)).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(emitted.filter((item) => item.status === "accepted")).toHaveLength(1);
  });

  it("re-emits durable pending and resolved approvals after delivery faults without executing early", async () => {
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({ userRoot });
    const execute = vi.fn(async () => ({ ok: true }));
    const input = request("type", { selector: "input[name=password]", text: "never-log-this", clear: true });
    let failPending = true;
    await expect(handleBrowserDynamicToolCall(input, context(approvalStore, execute, [], {
      callStore,
      emitApproval: async (item) => {
        if (item.status === "pending" && failPending) {
          failPending = false;
          throw new Error("synthetic stream interruption");
        }
      },
    }))).rejects.toThrow("synthetic stream interruption");
    expect(execute).not.toHaveBeenCalled();

    const emitted: ApprovalItem[] = [];
    let failResolved = true;
    const replay = handleBrowserDynamicToolCall(input, context(approvalStore, execute, emitted, {
      callStore,
      emitApproval: async (item) => {
        emitted.push(item);
        if (item.status !== "pending" && failResolved) {
          failResolved = false;
          throw new Error("synthetic resolved stream interruption");
        }
      },
    }));
    await vi.waitFor(
      () => expect(emitted.some((item) => item.status === "pending")).toBe(true),
      STORAGE_WAIT_OPTIONS,
    );
    const approval = emitted.find((item) => item.status === "pending") as ApprovalItem;
    expect(approval.detail).not.toContain("never-log-this");
    await approvalStore.resolve(approvalLocatorFromItem(INSTALLATION_ID, USER_ID, approval), "accept");
    await expect(replay).rejects.toThrow("synthetic resolved stream interruption");
    expect(execute).not.toHaveBeenCalled();

    const finalEvents: ApprovalItem[] = [];
    await expect(handleBrowserDynamicToolCall(input, context(approvalStore, execute, finalEvents, { callStore })))
      .resolves.toMatchObject({ success: true });
    expect(finalEvents).toEqual([expect.objectContaining({ status: "accepted" })]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects cross-thread calls, arbitrary tools and unknown argument fields before execution", async () => {
    const { approvalStore } = await fixture();
    const execute = vi.fn();
    const ctx = context(approvalStore, execute, []);
    await expect(handleBrowserDynamicToolCall(
      request("read", {}, { threadId: "runtime-thread-other" }),
      ctx,
    )).rejects.toMatchObject({ code: "BROWSER_TOOL_SCOPE_MISMATCH" });
    await expect(handleBrowserDynamicToolCall(
      request("Runtime.evaluate", { expression: "steal()" }),
      ctx,
    )).rejects.toMatchObject({ code: "BROWSER_TOOL_REJECTED" });
    await expect(handleBrowserDynamicToolCall(
      request("click", { selector: "button", method: "Runtime.evaluate" }),
      ctx,
    )).rejects.toMatchObject({ code: "BROWSER_TOOL_ARGUMENTS_INVALID" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed instead of replaying a call left executing by a crash", async () => {
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({
      userRoot,
      executionOwnerId: "11111111-1111-4111-8111-111111111111",
    });
    const input = request("read", {});
    const argumentsHash = await import("node:crypto").then(({ createHash }) => createHash("sha256")
      .update(JSON.stringify({ arguments: {}, browserThreadId: BROWSER_THREAD_A }))
      .digest("hex"));
    const identity = {
      installationId: INSTALLATION_ID,
      userId: USER_ID,
      threadId: input.threadId,
      turnId: input.turnId,
      callId: input.callId,
      tool: input.tool,
      argumentsHash,
      permissionFingerprint: FINGERPRINT,
    };
    await callStore.begin(identity);
    await callStore.markExecuting(identity);
    const recoveredStore = new BrowserToolCallStore({
      userRoot,
      executionOwnerId: "22222222-2222-4222-8222-222222222222",
    });
    const execute = vi.fn();
    const response = await handleBrowserDynamicToolCall(
      input,
      context(approvalStore, execute, [], { callStore: recoveredStore }),
    );
    expect(response).toMatchObject({ success: false });
    expect(response.contentItems[0]).toMatchObject({
      type: "inputText",
      text: expect.stringContaining("not replayed"),
    });
    expect(execute).not.toHaveBeenCalled();
    await expect(recoveredStore.begin(identity)).resolves.toMatchObject({
      status: "indeterminate",
      response: expect.objectContaining({ success: false }),
    });
  });

  it("records a permission denial and never asks for approval or touches the browser", async () => {
    const { approvalStore } = await fixture();
    const execute = vi.fn();
    const emitted: ApprovalItem[] = [];
    const response = await handleBrowserDynamicToolCall(
      request("open", { url: "https://example.test/" }),
      context(approvalStore, execute, emitted, { permissions: permissions(false) }),
    );
    expect(response.success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it("does not let browser.read authorize browser mutations", async () => {
    const { approvalStore } = await fixture();
    const execute = vi.fn(async () => ({ schemaVersion: 1, url: "about:blank", title: "", text: "", links: [] }));
    const readOnly = browserPermissions([{
      ruleId: "browser.read",
      action: "consult",
      effect: "allow",
      instruction: "Read-only browser access.",
      sourceScope: "installation",
      sourcePolicyVersion: 1,
      precedence: 100,
    }]);
    const read = await handleBrowserDynamicToolCall(
      request("read", {}),
      context(approvalStore, execute, [], { permissions: readOnly }),
    );
    const open = await handleBrowserDynamicToolCall(
      request("open", { url: "https://example.test/" }),
      context(approvalStore, execute, [], { permissions: readOnly }),
    );
    expect(read.success).toBe(true);
    expect(open.success).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
  });
});
