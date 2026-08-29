import { beforeEach, describe, expect, it, vi } from "vitest";

const projectId = "00000000-0000-4000-8000-000000000011";
const mocks = vi.hoisted(() => ({
  session: {
    current: {
      tenant: { id: "qa-company", name: "QA" },
      user: { id: "00000000-0000-4000-8000-000000000001", name: "Arnau", email: "arnau@example.test" },
    } as { tenant: { id: string; name: string }; user: { id: string; name: string; email: string } } | null,
  },
  readRegularFileWithin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({ getSession: async () => mocks.session.current }));
vi.mock("@/config/installation", () => ({
  loadInstallationConfig: async () => ({ installationId: "qa-company" }),
}));
vi.mock("@/workbench/store", () => ({
  getProjectRuntimeContext: async () => ({ projectId }),
}));
vi.mock("@/runtime/workers/provisioner", () => ({
  deriveWorkerRoots: () => ({ workspace: "/private/workspaces" }),
  resolveWorkerOwnedPath: async () => "/private/workspaces/projects/00000000-0000-4000-8000-000000000011",
}));
vi.mock("@/security/safe-file", () => ({
  readRegularFileWithin: mocks.readRegularFileWithin,
}));

import { GET } from "@/app/api/projects/[projectId]/files/route";

function request(filePath: string, raw = false, download = false) {
  return new Request(`https://brain.example/api/projects/${projectId}/files?path=${encodeURIComponent(filePath)}${raw ? "&raw=1" : ""}${download ? "&download=1" : ""}`);
}

describe("workspace file preview route", () => {
  beforeEach(() => {
    mocks.session.current = {
      tenant: { id: "qa-company", name: "QA" },
      user: { id: "00000000-0000-4000-8000-000000000001", name: "Arnau", email: "arnau@example.test" },
    };
    mocks.readRegularFileWithin.mockReset();
    mocks.readRegularFileWithin.mockResolvedValue(Buffer.from("export const ready = true;"));
  });

  it("returns the current authenticated workspace file as bounded text", async () => {
    const response = await GET(request("src/example.ts"), { params: Promise.resolve({ projectId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      file: {
        path: "src/example.ts",
        name: "example.ts",
        kind: "text",
        mimeType: "text/plain",
        size: 26,
        language: "TypeScript",
        content: "export const ready = true;",
        previewUrl: null,
      },
    });
    expect(mocks.readRegularFileWithin).toHaveBeenCalledWith(
      "/private/workspaces/projects/00000000-0000-4000-8000-000000000011",
      "src/example.ts",
      8_000_000,
    );
  });

  it("accepts Codex absolute paths only through the same confined workspace boundary", async () => {
    const absolutePath = "/private/workspaces/projects/00000000-0000-4000-8000-000000000011/src/example.ts";
    const response = await GET(request(absolutePath), { params: Promise.resolve({ projectId }) });

    expect(response.status).toBe(200);
    expect(mocks.readRegularFileWithin).toHaveBeenCalledWith(
      "/private/workspaces/projects/00000000-0000-4000-8000-000000000011",
      "src/example.ts",
      8_000_000,
    );
  });

  it("serves images inline and keeps unauthenticated reads closed", async () => {
    mocks.readRegularFileWithin.mockResolvedValueOnce(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const image = await GET(request("public/preview.png", true), { params: Promise.resolve({ projectId }) });
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(image.headers.get("Cache-Control")).toBe("private, no-store");
    expect(image.headers.get("Content-Disposition")).toContain("inline");

    mocks.readRegularFileWithin.mockResolvedValueOnce(Buffer.from("%PDF-1.7\nfixture"));
    const pdfDownload = await GET(request("informes/informe.pdf", true, true), { params: Promise.resolve({ projectId }) });
    expect(pdfDownload.status).toBe(200);
    expect(pdfDownload.headers.get("Content-Disposition")).toContain("attachment");
    expect(pdfDownload.headers.get("Content-Type")).toBe("application/pdf");
    expect(mocks.readRegularFileWithin).toHaveBeenLastCalledWith(
      "/private/workspaces/projects/00000000-0000-4000-8000-000000000011",
      "informes/informe.pdf",
      50 * 1024 * 1024,
    );

    mocks.session.current = null;
    const unauthenticated = await GET(request("src/example.ts"), { params: Promise.resolve({ projectId }) });
    expect(unauthenticated.status).toBe(401);
  });

  it("rejects malformed queries before reading the workspace", async () => {
    const response = await GET(
      new Request(`https://brain.example/api/projects/${projectId}/files?path=src%2Fa.ts&path=src%2Fb.ts`),
      { params: Promise.resolve({ projectId }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.readRegularFileWithin).not.toHaveBeenCalled();
  });
});
