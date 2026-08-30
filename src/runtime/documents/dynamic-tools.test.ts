import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedPermissions } from "@/permissions";
import {
  AIBRAIN_DOCUMENT_TOOL_NAMESPACE,
  handleLocalDocumentDynamicToolCall,
  type LocalDocumentDynamicToolContext,
} from "@/runtime/documents/dynamic-tools";

const INSTALLATION_ID = "documents-qa";
const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function permissions(userId: string, effect: "allow" | "deny" = "allow"): ResolvedPermissions {
  return {
    schemaVersion: 1,
    installationId: INSTALLATION_ID,
    userId,
    roleId: null,
    projectId: PROJECT_ID,
    turnId: "30000000-0000-4000-8000-000000000001",
    resolvedAt: "2026-08-30T00:00:00.000Z",
    fingerprint: "a".repeat(64),
    sources: [],
    rules: [{
      ruleId: "tools.execute",
      action: "execute",
      effect,
      instruction: "Local tools",
      sourceScope: "installation",
      sourcePolicyVersion: 1,
      precedence: 100,
    }],
    developerInstructions: `Policy fingerprint: ${"a".repeat(64)}`,
  };
}

async function context(userId: string): Promise<LocalDocumentDynamicToolContext> {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-local-doc-tool-"));
  roots.push(root);
  const workspace = path.join(root, "users", userId, "workspace", "projects", PROJECT_ID);
  const receiptRoot = path.join(root, "users", userId, "state", "document-generation-calls");
  await Promise.all([mkdir(workspace, { recursive: true, mode: 0o700 }), mkdir(receiptRoot, { recursive: true, mode: 0o700 })]);
  return {
    installationId: INSTALLATION_ID,
    userId,
    projectId: PROJECT_ID,
    projectWorkspace: workspace,
    receiptRoot,
    runtimeThreadId: "runtime-thread",
    runtimeTurnId: "runtime-turn",
    permissions: permissions(userId),
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  };
}

function request(callId: string, format: "pdf" | "docx" | "pptx" | "xlsx") {
  return {
    threadId: "runtime-thread",
    turnId: "runtime-turn",
    callId,
    namespace: AIBRAIN_DOCUMENT_TOOL_NAMESPACE,
    tool: "create",
    arguments: {
      format,
      fileName: `resultado.${format}`,
      title: `Resultado ${format}`,
      content: format === "xlsx" ? "Nombre\tImporte\nServicio\t1250" : "Resumen\nContenido verificable",
      ...(format === "xlsx" ? { rows: [["Nombre", "Importe"], ["Servicio", 1250]] } : {}),
    },
  } as const;
}

describe("local document dynamic tool", () => {
  it("creates, verifies and projects all four formats from a private project workspace", async () => {
    const ctx = await context(USER_A);
    for (const format of ["pdf", "docx", "pptx", "xlsx"] as const) {
      const result = await handleLocalDocumentDynamicToolCall(request(`call-${format}`, format), ctx);
      expect(result.response.success).toBe(true);
      expect(result.artifact).toMatchObject({
        kind: format,
        status: "ready",
        url: expect.stringContaining("raw=1&download=1"),
        previewUrl: expect.stringContaining(format === "pdf" ? "raw=1" : "representation=1"),
      });
      const payload = JSON.parse((result.response.contentItems[0] as { text: string }).text);
      expect(payload).toMatchObject({ storage: "local-private-workspace", externalConnectorUsed: false, format });
      expect(payload.size).toBeGreaterThan(100);
      expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect((await readdir(path.join(ctx.projectWorkspace, "documents"))).sort()).toEqual([
      "resultado.docx", "resultado.pdf", "resultado.pptx", "resultado.xlsx",
    ]);
  }, 30_000);

  it("replays the same call exactly once and rejects a changed replay", async () => {
    const ctx = await context(USER_A);
    const first = await handleLocalDocumentDynamicToolCall(request("stable-call", "pdf"), ctx);
    const replay = await handleLocalDocumentDynamicToolCall(request("stable-call", "pdf"), ctx);
    expect(replay).toEqual(first);
    expect(await readdir(path.join(ctx.projectWorkspace, "documents"))).toEqual(["resultado.pdf"]);

    const changed = request("stable-call", "pdf");
    const conflict = await handleLocalDocumentDynamicToolCall({
      ...changed,
      arguments: { ...changed.arguments, content: "Contenido distinto" },
    }, ctx);
    expect(conflict.response.success).toBe(false);
    expect((conflict.response.contentItems[0] as { text: string }).text).toContain("does not match");
  }, 20_000);

  it("fails closed for a denied user and cannot replay another user's receipt", async () => {
    const userA = await context(USER_A);
    const userB = await context(USER_B);
    const created = await handleLocalDocumentDynamicToolCall(request("private-call", "docx"), userA);
    expect(created.response.success).toBe(true);

    const denied = await handleLocalDocumentDynamicToolCall(request("denied-call", "docx"), {
      ...userB,
      permissions: permissions(USER_B, "deny"),
    });
    expect(denied.response.success).toBe(false);
    await expect(readdir(path.join(userB.projectWorkspace, "documents"))).rejects.toMatchObject({ code: "ENOENT" });

    const wrongIdentity = await handleLocalDocumentDynamicToolCall(request("private-call", "docx"), {
      ...userB,
      userId: USER_A,
    });
    expect(wrongIdentity.response.success).toBe(false);
  });
});
