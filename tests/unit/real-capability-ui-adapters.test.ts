import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseDocumentUploadResponse,
  stageDocument,
} from "@/ui/document-ui-adapter";
import {
  controlBrowser,
  BrowserUiRequestError,
  isRecoverableBrowserViewerError,
  issueBrowserViewerToken,
  parseBrowserStatus,
  readBrowserActionHistory,
  readBrowserFrame,
  sendBrowserViewerCommand,
  shouldPresentBrowserPanel,
} from "@/ui/browser-ui-adapter";
import {
  isSafePublicationTarget,
  parsePublicationDecisionReceipt,
  parsePublicationFreezeReceipt,
} from "@/ui/publication-ui-adapter";
import {
  createExplicitMemory,
  listExplicitMemories,
  revokeExplicitMemory,
} from "@/ui/memory-ui-adapter";

const threadId = "0198b9f0-6631-7000-8000-000000000302";
const uploadId = "0198b9f0-6631-7000-8000-000000000511";
const browserSessionId = "0198b9f0-6631-7000-8000-000000000699";
const operationId = "0198b9f0-6631-7000-8000-000000000615";
const turnId = "0198b9f0-6631-7000-8000-000000000612";

const documentResponse = {
  document: {
    schemaVersion: 1,
    uploadId,
    threadId,
    fileName: "notes.md",
    relativePath: "opaque/server/path",
    kind: "text",
    mediaType: "text/markdown",
    size: 17,
    sha256: "a".repeat(64),
    status: "staged",
    createdAt: "2026-08-27T10:00:00.000Z",
  },
  preview: {
    schemaVersion: 2,
    uploadId,
    threadId,
    sourceSha256: "a".repeat(64),
    status: "ready",
    kind: "text",
    files: [{
      name: "preview.txt",
      url: `/api/threads/${threadId}/documents/${uploadId}/preview/preview.txt`,
    }],
    artifacts: [{ fileName: "preview.txt", size: 17, sha256: "a".repeat(64) }],
    pages: null,
    createdAt: "2026-08-27T10:00:01.000Z",
  },
};

const browserStatus = {
  available: true,
  capabilityCode: null,
  healthy: true,
  state: {
    browserSessionId,
    lifecycle: "ready",
    controller: "agent",
    generation: 1,
    heartbeatExpiresAt: null,
    downloads: [{ id: "download-1", fileName: "result.pdf", status: "complete", sizeBytes: 42 }],
  },
  runtime: { healthy: true },
  runningInProcess: true,
};

const publicationOperation = {
  schemaVersion: 1,
  operationId,
  installationId: "example-lab-playwright",
  userId: "0198b9f0-6631-7000-8000-000000000600",
  threadId,
  turnId,
  targetRelativePath: "knowledge/notes.md",
  status: "awaiting_confirmation",
  candidate: { fileName: "notes.md", size: 17, sha256: "a".repeat(64) },
  preview: {
    schemaVersion: 1,
    previewId: uploadId,
    threadId,
    turnId,
    candidateSha256: "a".repeat(64),
    status: "ready",
    artifacts: ["preview.txt"],
    createdAt: "2026-08-27T10:00:00.000Z",
  },
  original: { exists: false, size: null, sha256: null, mtimeMs: null },
  confirmationExpiresAt: "2026-08-27T10:10:00.000Z",
  version: null,
  result: null,
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};

const memory = {
  schemaVersion: 1,
  memoryId: "0198b9f0-6631-7000-8000-000000000724",
  installationId: "example-lab-playwright",
  subjectUserId: "0198b9f0-6631-7000-8000-000000000600",
  kind: "decision",
  content: "Use the approved handoff.",
  provenance: {
    sourceType: "manual",
    sourceId: "0198b9f0-6631-7000-8000-000000000725",
    sourceExcerpt: "Use the approved handoff.",
    capturedAt: "2026-08-27T10:00:00.000Z",
  },
  explicit: true,
  createdBy: "0198b9f0-6631-7000-8000-000000000600",
  createdAt: "2026-08-27T10:00:00.000Z",
  status: "active",
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
  idempotencyKey: "manual:0198b9f0-6631-7000-8000-000000000725",
};

afterEach(() => vi.unstubAllGlobals());

describe("document UI adapter", () => {
  it("accepts only authoritative preview URLs and never returns server paths", () => {
    const parsed = parseDocumentUploadResponse(documentResponse);
    expect(parsed?.document).not.toHaveProperty("relativePath");
    expect(parsed?.preview.files[0]?.url).toBe(`/api/threads/${threadId}/documents/${uploadId}/preview/preview.txt`);
    expect(parseDocumentUploadResponse({
      ...documentResponse,
      preview: { ...documentResponse.preview, files: [{ name: "preview.txt", url: "https://attacker.test/file" }] },
    })).toBeNull();
  });

  it("stages multipart with the client UUID and honors typed retry errors", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      expect((init?.body as FormData).get("uploadId")).toBe(uploadId);
      return Response.json(documentResponse, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(stageDocument(threadId, new File(["Private document\n"], "notes.md", { type: "text/markdown" }), uploadId))
      .resolves.toMatchObject({ document: { uploadId, threadId } });
  });
});

describe("browser UI adapter", () => {
  it("fails closed on malformed lifecycle state", () => {
    expect(parseBrowserStatus(browserStatus)).toMatchObject({ state: { lifecycle: "ready" } });
    expect(shouldPresentBrowserPanel(parseBrowserStatus(browserStatus), true)).toBe(true);
    expect(shouldPresentBrowserPanel(parseBrowserStatus({ ...browserStatus, available: false }), true)).toBe(false);
    expect(parseBrowserStatus({ healthy: true, state: browserStatus.state, runtime: null, runningInProcess: true })).toBeNull();
    expect(parseBrowserStatus({ ...browserStatus, state: { ...browserStatus.state, lifecycle: "invented" } })).toBeNull();
  });

  it("accepts only thread-bound, secret-free browser action history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ history: [{
      schemaVersion: 1,
      sequence: 2,
      installationId: "browser-lab",
      userId: "0198b9f0-6631-7000-8000-000000000600",
      threadId,
      turnId: "turn-1",
      callId: "call-1",
      action: "click",
      phase: "completed",
      success: true,
      actor: "agent",
      occurredAt: "2026-08-30T10:00:00.000Z",
    }, {
      schemaVersion: 1,
      sequence: 3,
      installationId: "browser-lab",
      userId: "0198b9f0-6631-7000-8000-000000000600",
      threadId,
      turnId: "manual-takeover",
      callId: "manual-call-1",
      action: "type",
      phase: "dispatched",
      success: true,
      actor: "human",
      occurredAt: "2026-08-30T10:00:01.000Z",
    }] })));
    await expect(readBrowserActionHistory(threadId)).resolves.toMatchObject([
      { threadId, action: "click", phase: "completed", success: true },
      { threadId, action: "type", phase: "dispatched", actor: "human" },
    ]);
  });

  it("keeps viewer tokens in authorization headers and outside URLs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/token")) return Response.json({ token: "private-token-value-with-signature", browserSessionId });
      if (url.includes("/viewer/frame")) {
        expect(url).not.toContain("private-token");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token-value-with-signature");
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "Content-Type": "image/png" } });
      }
      if (url.endsWith("/viewer/input")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token-value-with-signature");
        return Response.json({ ok: true });
      }
      return Response.json(browserStatus);
    });
    vi.stubGlobal("fetch", fetchMock);
    const issued = await issueBrowserViewerToken(threadId, true);
    await expect(readBrowserFrame(threadId, issued.token)).resolves.toBeInstanceOf(Blob);
    await expect(sendBrowserViewerCommand(threadId, issued.token, { action: "navigate", url: "https://example.com/" })).resolves.toBeUndefined();
    await expect(controlBrowser("takeover")).resolves.toMatchObject({ state: { lifecycle: "ready" } });
  });

  it("classifies a fenced viewer session as recoverable without hiding authorization failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: "La sessió del visor ha canviat. S’està reconnectant.",
      code: "BROWSER_GATEWAY_BINDING_INVALID",
      retryable: true,
    }, { status: 409 })));
    const fenced = await readBrowserFrame(threadId, "stale-token").catch((error: unknown) => error);
    expect(fenced).toBeInstanceOf(BrowserUiRequestError);
    expect(fenced).toMatchObject({ status: 409, code: "BROWSER_GATEWAY_BINDING_INVALID", retryable: true });
    expect(isRecoverableBrowserViewerError(fenced)).toBe(true);

    const forbidden = new BrowserUiRequestError("Forbidden", 403, "BROWSER_GATEWAY_SIGNATURE_INVALID", false);
    expect(isRecoverableBrowserViewerError(forbidden)).toBe(false);
  });
});

describe("publication UI adapter", () => {
  it("accepts the public receipt without exposing publisher paths or token hashes", () => {
    const parsed = parsePublicationFreezeReceipt({
      operation: publicationOperation,
      confirmationToken: "v1.synthetic-confirmation-token",
      permissionFingerprint: "b".repeat(64),
    });
    expect(parsed?.operation).toMatchObject({ operationId, targetRelativePath: "knowledge/notes.md" });
    expect(JSON.stringify(parsed)).not.toContain("snapshotRelativePath");
    expect(parsePublicationFreezeReceipt({
      operation: { ...publicationOperation, candidate: { ...publicationOperation.candidate, snapshotRelativePath: "private/candidate" } },
      confirmationToken: "v1.synthetic-confirmation-token",
      permissionFingerprint: "b".repeat(64),
    })).toBeNull();
  });

  it("fails closed on unsafe destinations and malformed terminal receipts", () => {
    expect(isSafePublicationTarget("knowledge/notes.md")).toBe(true);
    expect(isSafePublicationTarget("../notes.md")).toBe(false);
    expect(parsePublicationDecisionReceipt({
      operation: { ...publicationOperation, status: "published", result: { size: 17, sha256: "a".repeat(64), publishedAt: "invalid", recoveredAfterInterruption: false } },
      permissionFingerprint: "b".repeat(64),
    })).toBeNull();
  });

  it("rejects preview metadata that drifts from the frozen candidate", () => {
    expect(parsePublicationFreezeReceipt({
      operation: {
        ...publicationOperation,
        preview: { ...publicationOperation.preview, candidateSha256: "c".repeat(64) },
      },
      confirmationToken: "v1.synthetic-confirmation-token",
      permissionFingerprint: "b".repeat(64),
    })).toBeNull();
    expect(parsePublicationFreezeReceipt({
      operation: {
        ...publicationOperation,
        preview: { ...publicationOperation.preview, artifacts: ["preview.txt", "../private"] },
      },
      confirmationToken: "v1.synthetic-confirmation-token",
      permissionFingerprint: "b".repeat(64),
    })).toBeNull();
  });
});

describe("memory UI adapter", () => {
  it("uses only the explicit-memory routes and client generated request ids", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/revoke")) return Response.json({ memory: { ...memory, status: "revoked" } });
      if (init?.method === "POST") return Response.json({ memory }, { status: 201 });
      return Response.json({ memories: [memory] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(listExplicitMemories()).resolves.toEqual([memory]);
    await expect(createExplicitMemory({ kind: "decision", content: memory.content })).resolves.toEqual(memory);
    await expect(revokeExplicitMemory(memory.memoryId, "Replaced by a newer decision.")).resolves.toMatchObject({ status: "revoked" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/memory?status=all&limit=100");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/memory");
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/memory/${memory.memoryId}/revoke`);
    const createBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(createBody).toMatchObject({ explicit: true, kind: "decision", content: memory.content });
    expect(createBody.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("fails closed when a memory response is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ memories: [{ memoryId: memory.memoryId }] })));
    await expect(listExplicitMemories()).rejects.toThrow("respuesta de memoria no es válida");
  });
});
