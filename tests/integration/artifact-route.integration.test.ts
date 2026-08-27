import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/auth/types";

const USER_A = "0198b9f0-6631-7000-8000-000000000401";
const USER_B = "0198b9f0-6631-7000-8000-000000000402";
const PROJECT_ID = "0198b9f0-6631-7000-8000-000000000411";
const ARTIFACT_ID = "0198b9f0-6631-7000-8000-000000000421";
const state = vi.hoisted(() => ({ session: null as AuthSession | null, root: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({ getSession: vi.fn(async () => state.session) }));
vi.mock("@/config/installation", () => ({
  loadInstallationConfig: vi.fn(async () => ({ installationId: "artifact-route-qa" })),
}));
vi.mock("@/workbench/store", () => ({
  getProjectRuntimeContext: vi.fn(async (session: AuthSession, projectId: string) => {
    if (session.user.id !== USER_A || projectId !== PROJECT_ID) throw new Error("Not found.");
    return { projectId };
  }),
}));
vi.mock("@/runtime/workers/provisioner", () => ({
  deriveWorkerRoots: vi.fn((_installation: unknown, userId: string) => ({
    workspace: path.join(state.root, "users", userId, "workspace"),
  })),
  resolveWorkerOwnedPath: vi.fn(async (root: string, relativePath: string) =>
    path.join(root, relativePath)),
}));

function session(userId: string): AuthSession {
  return {
    provider: "local",
    user: { id: userId, name: "Artifact user", email: `${userId}@example.test` },
    tenant: { id: "artifact-route-qa", name: "Artifact Route QA" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("private generated artifact route", () => {
  beforeAll(async () => {
    state.root = await mkdtemp(path.join(tmpdir(), "aibrain-artifact-route-"));
    const artifactRoot = path.join(
      state.root,
      "users",
      USER_A,
      "workspace",
      "projects",
      PROJECT_ID,
      ".aibrain",
      "artifacts",
    );
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    await writeFile(path.join(artifactRoot, `${ARTIFACT_ID}.png`), Buffer.from("private-image"), { mode: 0o600 });
  });

  afterAll(async () => {
    state.session = null;
    await rm(state.root, { recursive: true, force: true });
  });

  it("never permits browser caching and reauthorizes the exact URL for every session", async () => {
    const route = await import("@/app/api/projects/[projectId]/artifacts/[artifactId]/route");
    const context = { params: Promise.resolve({ projectId: PROJECT_ID, artifactId: ARTIFACT_ID }) };

    state.session = session(USER_A);
    const first = await route.GET(new Request("http://localhost/artifact"), context);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await first.arrayBuffer()).toString("utf8")).toBe("private-image");

    state.session = null;
    expect((await route.GET(new Request("http://localhost/artifact"), context)).status).toBe(401);
    state.session = session(USER_B);
    expect((await route.GET(new Request("http://localhost/artifact"), context)).status).toBe(404);
  });
});
