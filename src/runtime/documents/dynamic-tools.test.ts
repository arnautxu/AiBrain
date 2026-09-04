import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPermissions } from "@/permissions";
import { persistGeneratedImageArtifact } from "@/runtime/generated-image-artifacts";
import {
  AIBRAIN_DOCUMENT_TOOL_NAMESPACE,
  handleLocalDocumentDynamicToolCall,
  type LocalDocumentDynamicToolContext,
} from "@/runtime/documents/dynamic-tools";
import { generatedPngFixture } from "../../../tests/helpers/png-fixture";

vi.mock("server-only", () => ({}));

const INSTALLATION_ID = "documents-qa";
const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const THREAD_ID = "30000000-0000-4000-8000-000000000002";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const PREVIOUS_MESSAGE_ID = "30000000-0000-4000-8000-000000000003";
const OTHER_THREAD_ID = "30000000-0000-4000-8000-000000000004";
const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
  const canonicalRoot = await realpath(root);
  const workspace = path.join(canonicalRoot, "users", userId, "workspace", "projects", PROJECT_ID);
  const receiptRoot = path.join(canonicalRoot, "users", userId, "state", "document-generation-calls");
  const installation = {
    installationId: INSTALLATION_ID,
    paths: {
      dataRoot: path.join(canonicalRoot, "data"),
      usersRoot: path.join(canonicalRoot, "users"),
      companyContextRoot: path.join(canonicalRoot, "company-context"),
      sourceReadRoot: path.join(canonicalRoot, "source-ro"),
      publishWriteRoot: path.join(canonicalRoot, "publish-rw"),
      backupsRoot: path.join(canonicalRoot, "backups"),
    },
  };
  await Promise.all([
    mkdir(workspace, { recursive: true, mode: 0o700 }),
    mkdir(receiptRoot, { recursive: true, mode: 0o700 }),
    mkdir(installation.paths.dataRoot, { recursive: true, mode: 0o700 }),
  ]);
  const canonicalWorkspace = await realpath(workspace);
  return {
    installation,
    installationId: INSTALLATION_ID,
    userId,
    projectId: PROJECT_ID,
    projectWorkspace: canonicalWorkspace,
    receiptRoot,
    runtimeThreadId: "runtime-thread",
    runtimeTurnId: "runtime-turn",
    sourceThreadId: THREAD_ID,
    sourceTurnId: MESSAGE_ID,
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

function batchRequest(callId = "hello-world-batch") {
  return {
    threadId: "runtime-thread",
    turnId: "runtime-turn",
    callId,
    namespace: AIBRAIN_DOCUMENT_TOOL_NAMESPACE,
    tool: "create_batch",
    arguments: {
      files: (["pdf", "docx", "pptx", "xlsx"] as const).map((format) => ({
        format,
        fileName: `hello-world.${format}`,
        title: "Hello world",
        content: "Hello world",
        ...(format === "xlsx" ? { rows: [["Message"], ["Hello world"]] } : {}),
      })),
    },
  } as const;
}

describe("local document dynamic tool", () => {
  it("creates, verifies and projects all four formats from a private project workspace", async () => {
    const ctx = await context(USER_A);
    for (const format of ["pdf", "docx", "pptx", "xlsx"] as const) {
      const result = await handleLocalDocumentDynamicToolCall(request(`call-${format}`, format), ctx);
      expect(result.response.success).toBe(true);
      expect(result.artifacts).toEqual([expect.objectContaining({
        kind: format,
        status: "ready",
        url: expect.stringContaining("raw=1&download=1"),
        previewUrl: expect.stringContaining(format === "pdf" ? "raw=1" : "representation=1"),
      })]);
      const payload = JSON.parse((result.response.contentItems[0] as { text: string }).text);
      expect(payload).toMatchObject({ storage: "local-private-workspace", externalConnectorUsed: false, format });
      expect(payload).not.toHaveProperty("path");
      expect(payload.size).toBeGreaterThan(100);
      expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect((await readdir(path.join(ctx.projectWorkspace, "documents"))).sort()).toEqual([
      "resultado.docx", "resultado.pdf", "resultado.pptx", "resultado.xlsx",
    ]);
  }, 30_000);

  it("creates four requested formats in one deterministic call with one artifact per file and no internal path", async () => {
    const ctx = await context(USER_A);
    const result = await handleLocalDocumentDynamicToolCall(batchRequest(), ctx);

    expect(result.response.success).toBe(true);
    expect(result.artifacts.map(({ kind }) => kind)).toEqual(["pdf", "docx", "pptx", "xlsx"]);
    expect(new Set(result.artifacts.map(({ id }) => id))).toHaveProperty("size", 4);
    expect(result.artifacts.every(({ targetLabel }) => targetLabel === null)).toBe(true);
    expect((await readdir(path.join(ctx.projectWorkspace, "documents"))).sort()).toEqual([
      "hello-world.docx", "hello-world.pdf", "hello-world.pptx", "hello-world.xlsx",
    ]);
    const payload = JSON.parse((result.response.contentItems[0] as { text: string }).text);
    expect(payload).toMatchObject({
      status: "created",
      storage: "local-private-workspace",
      externalConnectorUsed: false,
    });
    expect(payload.files).toHaveLength(4);
    expect(JSON.stringify(payload)).not.toContain(ctx.projectWorkspace);
    expect(JSON.stringify(payload)).not.toContain("/var/lib/");
    expect(payload.files.every((file: Record<string, unknown>) => !("path" in file))).toBe(true);

    const replay = await handleLocalDocumentDynamicToolCall(batchRequest(), ctx);
    expect(replay).toEqual(result);
    expect(await readdir(path.join(ctx.projectWorkspace, "documents"))).toHaveLength(4);

    const changed = batchRequest();
    const conflict = await handleLocalDocumentDynamicToolCall({
      ...changed,
      arguments: {
        files: [
          ...changed.arguments.files,
          { format: "pdf", fileName: "extra.pdf", title: "Extra", content: "Extra" },
        ],
      },
    }, ctx);
    expect(conflict.response.success).toBe(false);
    expect((conflict.response.contentItems[0] as { text: string }).text).toContain("does not match");
    expect(await readdir(path.join(ctx.projectWorkspace, "documents"))).toHaveLength(4);

    const uncertainCallId = "uncertain-batch";
    const receiptName = `${createHash("sha256").update(uncertainCallId).digest("hex")}.json`;
    await mkdir(path.join(ctx.receiptRoot, `${receiptName}.claim`), { recursive: true, mode: 0o700 });
    const uncertain = await handleLocalDocumentDynamicToolCall(batchRequest(uncertainCallId), ctx);
    expect(uncertain.response.success).toBe(false);
    expect((uncertain.response.contentItems[0] as { text: string }).text).toContain("indeterminate");
    expect(await readdir(path.join(ctx.projectWorkspace, "documents"))).toHaveLength(4);
  }, 30_000);

  it("resolves a generated PNG by opaque item id and creates a one-page image-only A4 PDF", async () => {
    const ctx = await context(USER_A);
    const sourceImageItemId = "generated-image-item-1";
    const sourcePng = generatedPngFixture(120, 80);
    const imageArtifact = await persistGeneratedImageArtifact({
      id: sourceImageItemId,
      type: "imageGeneration",
      result: sourcePng.toString("base64"),
    }, {
      installation: ctx.installation,
      projectWorkspace: ctx.projectWorkspace,
      projectId: ctx.projectId,
      threadId: ctx.sourceThreadId,
      messageId: ctx.sourceTurnId,
      storageOwnerId: ctx.userId,
    });
    expect(imageArtifact).not.toBeNull();

    const result = await handleLocalDocumentDynamicToolCall({
      threadId: ctx.runtimeThreadId,
      turnId: ctx.runtimeTurnId,
      callId: "image-to-pdf-call",
      namespace: AIBRAIN_DOCUMENT_TOOL_NAMESPACE,
      tool: "image_to_pdf",
      arguments: {
        sourceImageItemId,
        fileName: "imagen-generada.pdf",
        title: "Imagen generada",
      },
    }, ctx);

    expect(result.response.success).toBe(true);
    expect(result.artifacts).toEqual([expect.objectContaining({
      kind: "pdf",
      name: "imagen-generada.pdf",
      pages: 1,
      mimeType: "application/pdf",
    })]);
    const responsePayload = JSON.parse((result.response.contentItems[0] as { text: string }).text);
    expect(responsePayload).not.toHaveProperty("path");
    expect(JSON.stringify(responsePayload)).not.toContain(sourceImageItemId);
    expect(JSON.stringify(responsePayload)).not.toContain(ctx.projectWorkspace);

    const bytes = await readFile(path.join(ctx.projectWorkspace, "documents", "imagen-generada.pdf"));
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPages()[0]!;
    const resources = page.node.Resources()!;
    const xObjects = pdf.context.lookup(resources.get(PDFName.of("XObject")), PDFDict);
    const fonts = pdf.context.lookup(resources.get(PDFName.of("Font")), PDFDict);
    expect(pdf.getPageCount()).toBe(1);
    expect(page.getWidth()).toBeCloseTo(595.28, 2);
    expect(page.getHeight()).toBeCloseTo(841.89, 2);
    expect(xObjects.keys().length).toBeGreaterThan(0);
    expect(fonts.keys()).toHaveLength(0);
  }, 20_000);

  it("resolves an opaque image item from a previous assistant turn in the same thread", async () => {
    const ctx = await context(USER_A);
    const sourceImageItemId = "historical-generated-image-item";
    await persistGeneratedImageArtifact({
      id: sourceImageItemId,
      type: "imageGeneration",
      result: generatedPngFixture(96, 64).toString("base64"),
    }, {
      installation: ctx.installation,
      projectWorkspace: ctx.projectWorkspace,
      projectId: ctx.projectId,
      threadId: ctx.sourceThreadId,
      messageId: PREVIOUS_MESSAGE_ID,
      storageOwnerId: ctx.userId,
    });

    const result = await handleLocalDocumentDynamicToolCall({
      threadId: ctx.runtimeThreadId,
      turnId: ctx.runtimeTurnId,
      callId: "historical-image-to-pdf-call",
      namespace: AIBRAIN_DOCUMENT_TOOL_NAMESPACE,
      tool: "image_to_pdf",
      arguments: {
        sourceImageItemId,
        fileName: "imagen-anterior.pdf",
        title: "Imagen anterior",
      },
    }, ctx);

    expect(PREVIOUS_MESSAGE_ID).not.toBe(ctx.sourceTurnId);
    expect(result.response.success).toBe(true);
    const pdf = await PDFDocument.load(await readFile(path.join(ctx.projectWorkspace, "documents", "imagen-anterior.pdf")));
    expect(pdf.getPageCount()).toBe(1);
  }, 20_000);

  it("does not resolve historical image ids across thread or storage-owner boundaries", async () => {
    const ctx = await context(USER_A);
    const sourcePng = generatedPngFixture(48, 48).toString("base64");
    await persistGeneratedImageArtifact({
      id: "foreign-thread-image-item",
      type: "imageGeneration",
      result: sourcePng,
    }, {
      installation: ctx.installation,
      projectWorkspace: ctx.projectWorkspace,
      projectId: ctx.projectId,
      threadId: OTHER_THREAD_ID,
      messageId: PREVIOUS_MESSAGE_ID,
      storageOwnerId: ctx.userId,
    });
    await persistGeneratedImageArtifact({
      id: "foreign-owner-image-item",
      type: "imageGeneration",
      result: sourcePng,
    }, {
      installation: ctx.installation,
      projectWorkspace: ctx.projectWorkspace,
      projectId: ctx.projectId,
      threadId: ctx.sourceThreadId,
      messageId: PREVIOUS_MESSAGE_ID,
      storageOwnerId: USER_B,
    });

    for (const [callId, sourceImageItemId] of [
      ["foreign-thread-image-to-pdf", "foreign-thread-image-item"],
      ["foreign-owner-image-to-pdf", "foreign-owner-image-item"],
    ] as const) {
      const result = await handleLocalDocumentDynamicToolCall({
        threadId: ctx.runtimeThreadId,
        turnId: ctx.runtimeTurnId,
        callId,
        namespace: AIBRAIN_DOCUMENT_TOOL_NAMESPACE,
        tool: "image_to_pdf",
        arguments: { sourceImageItemId, fileName: `${callId}.pdf`, title: "Imagen privada" },
      }, ctx);
      expect(result.response.success).toBe(false);
      expect((result.response.contentItems[0] as { text: string }).text).toContain("LOCAL_DOCUMENT_SOURCE_IMAGE_INVALID");
    }
    await expect(readdir(path.join(ctx.projectWorkspace, "documents"))).resolves.toEqual([]);
  });

  it("rejects workspace paths and unknown image ids without creating a PDF", async () => {
    const ctx = await context(USER_A);
    const requestBase = {
      threadId: ctx.runtimeThreadId,
      turnId: ctx.runtimeTurnId,
      namespace: AIBRAIN_DOCUMENT_TOOL_NAMESPACE,
      tool: "image_to_pdf",
    } as const;
    const internalPath = await handleLocalDocumentDynamicToolCall({
      ...requestBase,
      callId: "image-path-rejected",
      arguments: {
        sourceImageItemId: "generated-image-item-1",
        sourceImagePath: "/var/lib/aibrain/private.png",
        fileName: "imagen.pdf",
        title: "Imagen",
      },
    }, ctx);
    expect(internalPath.response.success).toBe(false);
    expect((internalPath.response.contentItems[0] as { text: string }).text).toContain("LOCAL_DOCUMENT_ARGUMENTS_INVALID");

    const unknown = await handleLocalDocumentDynamicToolCall({
      ...requestBase,
      callId: "unknown-image-rejected",
      arguments: {
        sourceImageItemId: "missing-image-item",
        fileName: "imagen.pdf",
        title: "Imagen",
      },
    }, ctx);
    expect(unknown.response.success).toBe(false);
    expect((unknown.response.contentItems[0] as { text: string }).text).toContain("LOCAL_DOCUMENT_SOURCE_IMAGE_INVALID");
    await expect(readdir(path.join(ctx.projectWorkspace, "documents"))).resolves.toEqual([]);
  });

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

  it("uses no external connector and never inherits another employee's OAuth-backed result", async () => {
    const userA = await context(USER_A);
    const userB = await context(USER_B);
    const externalFetch = vi.fn(() => {
      throw new Error("local document generation must not access a provider");
    });
    vi.stubGlobal("fetch", externalFetch);
    vi.stubEnv("GOOGLE_DRIVE_OAUTH_TOKEN", "arnau-token-must-remain-unused");

    const privateRequest = {
      ...request("arnau-private-call", "docx"),
      arguments: {
        ...request("arnau-private-call", "docx").arguments,
        title: "Hello world",
        content: "Hello world",
      },
    };
    const created = await handleLocalDocumentDynamicToolCall(privateRequest, userA);
    expect(created.response.success).toBe(true);
    expect(JSON.parse((created.response.contentItems[0] as { text: string }).text)).toMatchObject({
      status: "created",
      externalConnectorUsed: false,
    });
    expect(externalFetch).not.toHaveBeenCalled();

    const foreignReplay = await handleLocalDocumentDynamicToolCall(
      privateRequest,
      { ...userB, receiptRoot: userA.receiptRoot },
    );
    expect(foreignReplay.response.success).toBe(false);
    expect(JSON.parse((foreignReplay.response.contentItems[0] as { text: string }).text)).toMatchObject({
      status: "failed",
      code: "LOCAL_DOCUMENT_RECEIPT_CONFLICT",
      externalConnectorUsed: false,
    });
    expect(externalFetch).not.toHaveBeenCalled();
  });
});
