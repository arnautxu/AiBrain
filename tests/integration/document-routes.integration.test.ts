import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/auth/types";
import { assertUiContract } from "../helpers/ui-contract";

const USER_A = "0198b9f0-6631-7000-8000-000000000501";
const USER_B = "0198b9f0-6631-7000-8000-000000000502";
const UPLOAD_ID = "0198b9f0-6631-7000-8000-000000000511";
const BAD_UPLOAD_ID = "0198b9f0-6631-7000-8000-000000000512";
const auth = vi.hoisted(() => ({ session: null as AuthSession | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => auth.session),
  isVercelPreviewDemoEnabled: () => false,
}));
vi.mock("@/auth/request-security", () => ({ isSameOriginMutation: vi.fn(async () => true) }));

function session(userId: string): AuthSession {
  return {
    provider: "local",
    user: {
      id: userId,
      name: `User ${userId.slice(-3)}`,
      email: `${userId.slice(-3)}@example.test`,
    },
    tenant: { id: "documents-lab", name: "Documents Lab" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function uploadRequest(uploadId: string, file: File) {
  const body = new FormData();
  body.set("uploadId", uploadId);
  body.set("file", file);
  return new Request("http://localhost/api/threads/thread/documents", {
    method: "POST",
    body,
  });
}

describe("authenticated document routes", () => {
  let root: string;
  let dataRoot: string;
  let previousConfig: string | undefined;
  let previousMinimumFreeBytes: string | undefined;
  let previousMinimumFreeRatio: string | undefined;
  let previousMaximumActiveUploads: string | undefined;
  let previousWorstCaseActiveBytes: string | undefined;
  let threadId: string;

  beforeAll(async () => {
    previousConfig = process.env.AIBRAIN_INSTALLATION_CONFIG;
    previousMinimumFreeBytes = process.env.AIBRAIN_MINIMUM_FREE_BYTES;
    previousMinimumFreeRatio = process.env.AIBRAIN_MINIMUM_FREE_RATIO;
    previousMaximumActiveUploads = process.env.AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS;
    previousWorstCaseActiveBytes = process.env.AIBRAIN_DOCUMENT_WORST_CASE_ACTIVE_BYTES;
    process.env.AIBRAIN_MINIMUM_FREE_BYTES = "0";
    process.env.AIBRAIN_MINIMUM_FREE_RATIO = "0";
    process.env.AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS = "1";
    process.env.AIBRAIN_DOCUMENT_WORST_CASE_ACTIVE_BYTES = "134217728";
    root = await mkdtemp(path.join(tmpdir(), "aibrain-document-routes-"));
    dataRoot = path.join(root, "data");
    const configPath = path.join(root, "installation.json");
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    await writeFile(configPath, `${JSON.stringify({
      schemaVersion: 1,
      installationId: "documents-lab",
      companyName: "Documents Lab",
      companySlug: "documents-lab",
      publicUrl: "http://localhost:3000",
      branding: {
        productName: "Documents Brain",
        logoPath: "/brand/logo.svg",
        faviconPath: "/brand/favicon.svg",
        accentColor: "#334455",
      },
      paths: {
        dataRoot,
        companyContextRoot: path.join(dataRoot, "company"),
        usersRoot: path.join(dataRoot, "users"),
        sourceReadRoot: path.join(root, "source-ro"),
        publishWriteRoot: path.join(root, "publish-rw"),
        backupsRoot: path.join(dataRoot, "backups"),
      },
    }, null, 2)}\n`, "utf8");
    process.env.AIBRAIN_INSTALLATION_CONFIG = configPath;

    const [{ loadInstallationConfig }, { UserProvisioner }, { FileWorkbenchStore }] = await Promise.all([
      import("@/config/installation"),
      import("@/users/provisioner"),
      import("@/workbench/filesystem-store"),
    ]);
    const installation = await loadInstallationConfig();
    const provisioner = new UserProvisioner(installation);
    await provisioner.provision({ userId: USER_A, email: `${USER_A.slice(-3)}@example.test`, displayName: "User A" });
    await provisioner.provision({ userId: USER_B, email: `${USER_B.slice(-3)}@example.test`, displayName: "User B" });
    const workbench = FileWorkbenchStore.fromInstallation(installation);
    const project = await workbench.createProject(USER_A, "Document Operations");
    threadId = (await workbench.createThread(USER_A, project.id, "Private upload")).id;
  });

  afterAll(async () => {
    auth.session = null;
    if (previousConfig === undefined) delete process.env.AIBRAIN_INSTALLATION_CONFIG;
    else process.env.AIBRAIN_INSTALLATION_CONFIG = previousConfig;
    if (previousMinimumFreeBytes === undefined) delete process.env.AIBRAIN_MINIMUM_FREE_BYTES;
    else process.env.AIBRAIN_MINIMUM_FREE_BYTES = previousMinimumFreeBytes;
    if (previousMinimumFreeRatio === undefined) delete process.env.AIBRAIN_MINIMUM_FREE_RATIO;
    else process.env.AIBRAIN_MINIMUM_FREE_RATIO = previousMinimumFreeRatio;
    if (previousMaximumActiveUploads === undefined) delete process.env.AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS;
    else process.env.AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS = previousMaximumActiveUploads;
    if (previousWorstCaseActiveBytes === undefined) delete process.env.AIBRAIN_DOCUMENT_WORST_CASE_ACTIVE_BYTES;
    else process.env.AIBRAIN_DOCUMENT_WORST_CASE_ACTIVE_BYTES = previousWorstCaseActiveBytes;
    await rm(root, { recursive: true, force: true });
  });

  it("stages, previews and serves a text document only to the owning user", async () => {
    const uploadRoute = await import("@/app/api/threads/[threadId]/documents/route");
    const previewRoute = await import(
      "@/app/api/threads/[threadId]/documents/[uploadId]/preview/[fileName]/route"
    );
    auth.session = null;
    expect((await uploadRoute.POST(
      uploadRequest(UPLOAD_ID, new File(["private"], "notes.md", { type: "text/markdown" })),
      { params: Promise.resolve({ threadId }) },
    )).status).toBe(401);

    auth.session = session(USER_A);
    const response = await uploadRoute.POST(
      uploadRequest(UPLOAD_ID, new File(["Private document\n"], "notes.md", { type: "text/markdown" })),
      { params: Promise.resolve({ threadId }) },
    );
    expect(response.status).toBe(201);
    const result = await response.json() as {
      document: { kind: string; sha256: string };
      preview: { files: Array<{ name: string; url: string }> };
    };
    expect(result).toMatchObject({
      document: { kind: "text" },
      preview: { files: [{ name: "preview.txt" }] },
    });
    expect(() => assertUiContract("DocumentUploadResponse", result)).not.toThrow();

    const previewContext = {
      params: Promise.resolve({ threadId, uploadId: UPLOAD_ID, fileName: "preview.txt" }),
    };
    const preview = await previewRoute.GET(new Request("http://localhost/preview"), previewContext);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Cache-Control")).toBe("private, no-store");
    expect(preview.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(preview.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(preview.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(preview.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await preview.text()).toBe("Private document\n");

    auth.session = session(USER_B);
    expect((await previewRoute.GET(new Request("http://localhost/preview"), previewContext)).status).toBe(404);
  });

  it("rejects false MIME before any staged response is returned", async () => {
    const uploadRoute = await import("@/app/api/threads/[threadId]/documents/route");
    auth.session = session(USER_A);
    const response = await uploadRoute.POST(
      uploadRequest(BAD_UPLOAD_ID, new File(["not a pdf"], "report.pdf", { type: "application/pdf" })),
      { params: Promise.resolve({ threadId }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "El document no supera la validació de seguretat." });
  });

  // This is a real filesystem route roundtrip with seven serialized durable
  // operations. Keep its deadline local to this test so runner I/O contention
  // cannot leave an operation writing after suite cleanup.
  it("roundtrips v1 to v2, preserves readable v1, restores it and rejects a stale base", async () => {
    const documentId = "0198b9f0-6631-7000-8000-000000000521";
    const versionTwoId = "0198b9f0-6631-7000-8000-000000000522";
    const staleAttemptId = "0198b9f0-6631-7000-8000-000000000523";
    const restoreId = "0198b9f0-6631-7000-8000-000000000524";
    const [uploadRoute, historyRoute, contentRoute, restoreRoute] = await Promise.all([
      import("@/app/api/threads/[threadId]/documents/route"),
      import("@/app/api/threads/[threadId]/documents/[uploadId]/route"),
      import("@/app/api/threads/[threadId]/documents/[uploadId]/versions/[versionId]/route"),
      import("@/app/api/threads/[threadId]/documents/[uploadId]/versions/[versionId]/restore/route"),
    ]);
    auth.session = session(USER_A);
    expect((await uploadRoute.POST(
      uploadRequest(documentId, new File(["version one"], "roundtrip.txt", { type: "text/plain" })),
      { params: Promise.resolve({ threadId }) },
    )).status).toBe(201);

    const initial = await historyRoute.GET(new Request("http://localhost/history"), {
      params: Promise.resolve({ threadId, uploadId: documentId }),
    });
    expect(initial.status).toBe(200);
    const initialBody = await initial.json() as { document: {
      scope: { kind: string; id: string };
      originalVersionId: string;
      versions: Array<{ versionId: string; etag: string; author: { userId: string; name: string }; createdAt: string; provenance: { type: string } }>;
    } };
    expect(initialBody.document.versions).toHaveLength(1);
    expect(initialBody.document).toMatchObject({
      originalVersionId: documentId,
      scope: { kind: "project" },
      versions: [{
        author: { userId: USER_A, name: expect.any(String) },
        createdAt: expect.any(String),
        provenance: { type: "original_upload" },
      }],
    });
    const v1Etag = initialBody.document.versions[0]!.etag;
    expect(initial.headers.get("ETag")).toBe(`"${v1Etag}"`);

    const missingBase = uploadRequest(
      "0198b9f0-6631-7000-8000-000000000525",
      new File(["missing base"], "roundtrip.txt", { type: "text/plain" }),
    );
    missingBase.headers.set("X-AiBrain-Document-Id", documentId);
    expect((await uploadRoute.POST(missingBase, { params: Promise.resolve({ threadId }) })).status).toBe(428);

    const v2Request = uploadRequest(versionTwoId, new File(["version two"], "roundtrip.txt", { type: "text/plain" }));
    v2Request.headers.set("If-Match", `"${v1Etag}"`);
    v2Request.headers.set("X-AiBrain-Document-Id", documentId);
    const v2Response = await uploadRoute.POST(v2Request, { params: Promise.resolve({ threadId }) });
    expect(v2Response.status).toBe(201);
    const v2Body = await v2Response.json() as { document: { versions: Array<{ versionId: string; etag: string }> } };
    expect(v2Body.document.versions.map((version) => version.versionId)).toEqual([documentId, versionTwoId]);
    const v2Etag = v2Body.document.versions[1]!.etag;

    const original = await contentRoute.GET(new Request("http://localhost/original"), {
      params: Promise.resolve({ threadId, uploadId: documentId, versionId: documentId }),
    });
    expect(original.status).toBe(200);
    expect(original.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await original.text()).toBe("version one");

    const staleRequest = uploadRequest(staleAttemptId, new File(["stale"], "roundtrip.txt", { type: "text/plain" }));
    staleRequest.headers.set("If-Match", `"${v1Etag}"`);
    staleRequest.headers.set("X-AiBrain-Document-Id", documentId);
    const conflict = await uploadRoute.POST(staleRequest, { params: Promise.resolve({ threadId }) });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });

    const restore = await restoreRoute.POST(new Request("http://localhost/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json", "If-Match": `"${v2Etag}"` },
      body: JSON.stringify({ restoreVersionId: restoreId }),
    }), { params: Promise.resolve({ threadId, uploadId: documentId, versionId: documentId }) });
    expect(restore.status).toBe(201);
    const restored = await restore.json() as { document: { latestVersionId: string; versions: Array<{ provenance: { type: string } }> } };
    expect(restored.document.latestVersionId).toBe(restoreId);
    expect(restored.document.versions.at(-1)?.provenance.type).toBe("restore");

    auth.session = session(USER_B);
    expect((await historyRoute.GET(new Request("http://localhost/history"), {
      params: Promise.resolve({ threadId, uploadId: documentId }),
    })).status).toBe(404);

    auth.session = { ...session(USER_A), tenant: { id: "other-tenant", name: "Other Tenant" } };
    expect((await historyRoute.GET(new Request("http://localhost/history"), {
      params: Promise.resolve({ threadId, uploadId: documentId }),
    })).status).toBe(403);
  }, 15_000);

  it("returns retry metadata before starting a conversion when shared capacity is saturated", async () => {
    const previousMaximum = process.env.AIBRAIN_DOCUMENT_MAX_CONVERSIONS;
    const previousRetry = process.env.AIBRAIN_DOCUMENT_RETRY_AFTER_MS;
    process.env.AIBRAIN_DOCUMENT_MAX_CONVERSIONS = "1";
    process.env.AIBRAIN_DOCUMENT_RETRY_AFTER_MS = "2500";
    const { FileDocumentConversionGate } = await import("@/documents/conversion-gate");
    const gate = new FileDocumentConversionGate({
      rootDirectory: path.join(dataRoot, "locks", "document-conversions"),
      maxConcurrent: 1,
    });
    let release!: () => void;
    let admitted!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { admitted = resolve; });
    const active = gate.run(async () => {
      admitted();
      await held;
    });
    await started;
    try {
      const uploadRoute = await import("@/app/api/threads/[threadId]/documents/route");
      auth.session = session(USER_A);
      const response = await uploadRoute.POST(
        uploadRequest(
          "0198b9f0-6631-7000-8000-000000000513",
          new File(["%PDF-1.7\n%%EOF\n"], "queued.pdf", { type: "application/pdf" }),
        ),
        { params: Promise.resolve({ threadId }) },
      );
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("3");
      expect(await response.json()).toEqual({
        error: "La conversió de documents està ocupada. Torna-ho a provar.",
      });
    } finally {
      release();
      await active;
      if (previousMaximum === undefined) delete process.env.AIBRAIN_DOCUMENT_MAX_CONVERSIONS;
      else process.env.AIBRAIN_DOCUMENT_MAX_CONVERSIONS = previousMaximum;
      if (previousRetry === undefined) delete process.env.AIBRAIN_DOCUMENT_RETRY_AFTER_MS;
      else process.env.AIBRAIN_DOCUMENT_RETRY_AFTER_MS = previousRetry;
    }
  });

  it("rejects a saturated storage slot before persisting the multipart body", async () => {
    const previousMaximum = process.env.AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS;
    const previousRetry = process.env.AIBRAIN_DOCUMENT_STORAGE_RETRY_AFTER_MS;
    process.env.AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS = "1";
    process.env.AIBRAIN_DOCUMENT_STORAGE_RETRY_AFTER_MS = "4200";
    const { FileDocumentStorageGate } = await import("@/documents/storage-gate");
    const gate = new FileDocumentStorageGate({
      rootDirectory: path.join(dataRoot, "locks", "document-storage"),
      capacityRoot: dataRoot,
      maxActiveUploads: 1,
      minimumFreeBytes: 0,
      minimumFreeRatioPpm: 0,
      worstCaseActiveBytes: 128 * 1024 * 1024,
    });
    let release!: () => void;
    let admitted!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { admitted = resolve; });
    const active = gate.run(async () => {
      admitted();
      await held;
    });
    await started;
    try {
      const uploadRoute = await import("@/app/api/threads/[threadId]/documents/route");
      auth.session = session(USER_A);
      const response = await uploadRoute.POST(
        uploadRequest(
          "0198b9f0-6631-7000-8000-000000000514",
          new File(["must not persist"], "blocked.txt", { type: "text/plain" }),
        ),
        { params: Promise.resolve({ threadId }) },
      );
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("5");
      expect(await response.json()).toEqual({
        error: "L’emmagatzematge de documents està protegit temporalment. Torna-ho a provar.",
      });
      const blockedUpload = path.join(
        dataRoot,
        "users",
        USER_A,
        "staging",
        "threads",
        threadId,
        "uploads",
        "0198b9f0-6631-7000-8000-000000000514",
      );
      await expect(import("node:fs/promises").then(({ lstat }) => lstat(blockedUpload)))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      release();
      await active;
      if (previousMaximum === undefined) delete process.env.AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS;
      else process.env.AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS = previousMaximum;
      if (previousRetry === undefined) delete process.env.AIBRAIN_DOCUMENT_STORAGE_RETRY_AFTER_MS;
      else process.env.AIBRAIN_DOCUMENT_STORAGE_RETRY_AFTER_MS = previousRetry;
    }
  });
});
