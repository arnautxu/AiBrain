import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

type ExecutedBrowserCommand = {
  installationId: string;
  userId: string;
  threadId: string;
  command: BrowserAgentCommand;
  approvalEvidence?: BrowserInformedApprovalEvidence;
  expectedResource?: BrowserActionResourceSnapshot;
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

  afterEach(async () => {
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

  it("persists explicit mutation approval without blocking a different turn", async () => {
    const { approvalStore } = await fixture();
    const execute = vi.fn(async ({ command }: { command: { action: string } }) => ({ action: command.action }));
    const emitted: ApprovalItem[] = [];
    let durableAtEmission = false;
    const pending = handleBrowserDynamicToolCall(
      request("open", { url: "https://example.test/approved" }),
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
    await vi.waitFor(() => expect(emitted.find((item) => item.status === "pending")).toBeDefined());
    const approval = emitted.find((item) => item.status === "pending") as ApprovalItem;
    expect(approval).toMatchObject({
      kind: "browser",
      permissionFingerprint: FINGERPRINT,
      threadId: "runtime-thread-a",
      turnId: "runtime-turn-a",
      itemId: "call-open",
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

  it("makes a post-dispatch browser failure indeterminate and terminal on replay", async () => {
    const { userRoot, approvalStore } = await fixture();
    const callStore = new BrowserToolCallStore({ userRoot });
    const execute = vi.fn(async () => { throw new Error("connection dropped after dispatch"); });
    const emitted: ApprovalItem[] = [];
    const input = request("click", { selector: "button[type=submit]" });
    const ctx = context(approvalStore, execute, emitted, {
      callStore,
      emitApproval: async (item) => {
        emitted.push(item);
        if (item.status === "pending") {
          await approvalStore.resolve(approvalLocatorFromItem(INSTALLATION_ID, USER_ID, item), "accept");
        }
      },
    });
    const first = await handleBrowserDynamicToolCall(input, ctx);
    const replay = await handleBrowserDynamicToolCall(input, ctx);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ success: false });
    expect(first.contentItems[0]).toMatchObject({ text: expect.stringContaining("indeterminate") });
    expect(execute).toHaveBeenCalledOnce();
    const audit = await callStore.readAudit();
    expect(audit.map(({ payload }) => payload.status)).toEqual([
      "reserved", "approval_requested", "approval_resolved", "executing", "indeterminate",
    ]);
    expect(audit.at(-1)?.payload.success).toBe(false);
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
    await vi.waitFor(() => expect(emitted.filter((item) => item.status === "pending")).toHaveLength(1));
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
    await vi.waitFor(() => expect(emitted.some((item) => item.status === "pending")).toBe(true));
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
