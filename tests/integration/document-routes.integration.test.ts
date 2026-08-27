import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/auth/types";

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
  let threadId: string;

  beforeAll(async () => {
    previousConfig = process.env.AIBRAIN_INSTALLATION_CONFIG;
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
    await provisioner.provision({ userId: USER_A, email: "a@example.test", displayName: "User A" });
    await provisioner.provision({ userId: USER_B, email: "b@example.test", displayName: "User B" });
    const workbench = FileWorkbenchStore.fromInstallation(installation);
    const project = await workbench.createProject(USER_A, "Document Operations");
    threadId = (await workbench.createThread(USER_A, project.id, "Private upload")).id;
  });

  afterAll(async () => {
    auth.session = null;
    if (previousConfig === undefined) delete process.env.AIBRAIN_INSTALLATION_CONFIG;
    else process.env.AIBRAIN_INSTALLATION_CONFIG = previousConfig;
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

    const previewContext = {
      params: Promise.resolve({ threadId, uploadId: UPLOAD_ID, fileName: "preview.txt" }),
    };
    const preview = await previewRoute.GET(new Request("http://localhost/preview"), previewContext);
    expect(preview.status).toBe(200);
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
});
