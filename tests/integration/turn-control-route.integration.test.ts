import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/auth/types";
import type { ChatMessage } from "@/lib/chat-contract";

const USER_A = "0198b9f0-6631-7000-8000-000000000401";
const USER_B = "0198b9f0-6631-7000-8000-000000000402";
const USER_MESSAGE = "0198b9f0-6631-7000-8000-000000000411";
const ASSISTANT_MESSAGE = "0198b9f0-6631-7000-8000-000000000412";
const STEER_REQUEST = "0198b9f0-6631-7000-8000-000000000413";
const STEER_MESSAGE = "0198b9f0-6631-7000-8000-000000000414";
const STOP_REQUEST = "0198b9f0-6631-7000-8000-000000000415";
const auth = vi.hoisted(() => ({ session: null as AuthSession | null }));
const controls = vi.hoisted(() => ({ calls: [] as Array<{ request: Record<string, unknown> }> }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => auth.session),
  getSigningSecret: () => "route-test-signing-secret-with-at-least-thirty-two-bytes",
  isVercelPreviewDemoEnabled: () => false,
}));
vi.mock("@/auth/request-security", () => ({ isSameOriginMutation: vi.fn(async () => true) }));
vi.mock("@/runtime/turn-control", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/runtime/turn-control")>();
  return {
    ...original,
    controlWorkerTurn: vi.fn(async (
      _identity: unknown,
      request: Record<string, unknown>,
      persist: (event: unknown) => Promise<void>,
    ) => {
      controls.calls.push({ request });
      await persist({
        type: "activity",
        item: {
          id: `${request.action}:${request.clientRequestId}`,
          kind: "system",
          label: "Control acceptat",
          status: request.action === "stop" ? "stopped" : "complete",
        },
      });
      if (request.action === "stop") await persist({ type: "stopped" });
      return { action: request.action };
    }),
  };
});

function session(userId: string): AuthSession {
  return {
    provider: "local",
    user: {
      id: userId,
      name: `User ${userId.slice(-3)}`,
      email: `${userId.slice(-3)}@example.test`,
    },
    tenant: { id: "control-lab", name: "Control Lab" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function message(id: string, role: ChatMessage["role"], status: ChatMessage["status"]): ChatMessage {
  return {
    id,
    role,
    content: role === "user" ? "Analitza el contracte" : "",
    createdAt: new Date().toISOString(),
    status,
    activity: [],
    plan: [],
    approvals: [],
    diff: "",
    attachments: [],
    artifacts: [],
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/runtime/turns/control", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("turn control route", () => {
  let root: string;
  let previousConfig: string | undefined;
  let threadId: string;

  beforeAll(async () => {
    previousConfig = process.env.AIBRAIN_INSTALLATION_CONFIG;
    root = await mkdtemp(path.join(tmpdir(), "aibrain-turn-control-route-"));
    const dataRoot = path.join(root, "data");
    const usersRoot = path.join(dataRoot, "users");
    await Promise.all([
      mkdir(path.join(usersRoot, USER_A), { recursive: true, mode: 0o700 }),
      mkdir(path.join(usersRoot, USER_B), { recursive: true, mode: 0o700 }),
    ]);
    const configPath = path.join(root, "installation.json");
    await writeFile(configPath, `${JSON.stringify({
      schemaVersion: 1,
      installationId: "control-lab",
      companyName: "Control Lab",
      companySlug: "control-lab",
      publicUrl: "http://localhost:3000",
      branding: {
        productName: "Control Brain",
        logoPath: "/brand/logo.svg",
        faviconPath: "/brand/favicon.svg",
        accentColor: "#334455",
      },
      paths: {
        dataRoot,
        companyContextRoot: path.join(dataRoot, "company"),
        usersRoot,
        sourceReadRoot: path.join(root, "source-ro"),
        publishWriteRoot: path.join(root, "publish-rw"),
        backupsRoot: path.join(dataRoot, "backups"),
      },
    }, null, 2)}\n`, "utf8");
    process.env.AIBRAIN_INSTALLATION_CONFIG = configPath;

    const [{ loadInstallationConfig }, { FileWorkbenchStore }, { FileTurnProjectionStore }, { issueThreadToken }] =
      await Promise.all([
        import("@/config/installation"),
        import("@/workbench/filesystem-store"),
        import("@/workbench/turn-projection-store"),
        import("@/runtime/thread-token"),
      ]);
    const installation = await loadInstallationConfig();
    const workbench = FileWorkbenchStore.fromInstallation(installation);
    const project = await workbench.createProject(USER_A, "Contract Review");
    const thread = await workbench.createThread(USER_A, project.id, "Review turn");
    threadId = thread.id;
    const assistant = message(ASSISTANT_MESSAGE, "assistant", "streaming");
    await workbench.beginThreadTurn(
      USER_A,
      threadId,
      message(USER_MESSAGE, "user", "complete"),
      assistant,
    );
    const projections = new FileTurnProjectionStore({
      installationId: installation.installationId,
      userId: USER_A,
      usersRoot: installation.paths.usersRoot,
    });
    await projections.initialize(threadId, assistant);
    await projections.setRuntimeThreadToken(
      threadId,
      ASSISTANT_MESSAGE,
      issueThreadToken("control-lab", USER_A, "runtime-thread-control"),
    );
    await projections.setRuntimeTurnId(threadId, ASSISTANT_MESSAGE, "runtime-turn-control");
  });

  afterAll(async () => {
    auth.session = null;
    if (previousConfig === undefined) delete process.env.AIBRAIN_INSTALLATION_CONFIG;
    else process.env.AIBRAIN_INSTALLATION_CONFIG = previousConfig;
    await rm(root, { recursive: true, force: true });
  });

  it("authenticates and persists steering exactly once without accepting runtime ids", async () => {
    const route = await import("@/app/api/runtime/turns/control/route");
    auth.session = null;
    expect((await route.POST(request({}))).status).toBe(401);

    auth.session = session(USER_A);
    expect((await route.POST(request({
      action: "steer",
      threadId,
      assistantMessageId: ASSISTANT_MESSAGE,
      clientRequestId: STEER_REQUEST,
      userMessageId: STEER_MESSAGE,
      message: "Inclou també els riscos operatius.",
      runtimeTurnId: "attacker-selected",
    }))).status).toBe(400);

    const body = {
      action: "steer",
      threadId,
      assistantMessageId: ASSISTANT_MESSAGE,
      clientRequestId: STEER_REQUEST,
      userMessageId: STEER_MESSAGE,
      message: "Inclou també els riscos operatius.",
    };
    const first = await route.POST(request(body));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, action: "steer", idempotent: false });
    const replay = await route.POST(request(body));
    expect(await replay.json()).toEqual({ ok: true, action: "steer", idempotent: true });
    expect(controls.calls.filter((call) => call.request.action === "steer")).toHaveLength(1);
  });

  it("confirms stop durably and denies another user access to the same ids", async () => {
    const route = await import("@/app/api/runtime/turns/control/route");
    auth.session = session(USER_B);
    expect((await route.POST(request({
      action: "stop",
      threadId,
      assistantMessageId: ASSISTANT_MESSAGE,
      clientRequestId: STOP_REQUEST,
    }))).status).toBe(404);

    auth.session = session(USER_A);
    const stopped = await route.POST(request({
      action: "stop",
      threadId,
      assistantMessageId: ASSISTANT_MESSAGE,
      clientRequestId: STOP_REQUEST,
    }));
    expect(await stopped.json()).toEqual({ ok: true, action: "stop", idempotent: false });
    const replay = await route.POST(request({
      action: "stop",
      threadId,
      assistantMessageId: ASSISTANT_MESSAGE,
      clientRequestId: STOP_REQUEST,
    }));
    expect(await replay.json()).toEqual({ ok: true, action: "stop", idempotent: true });
    expect(controls.calls.filter((call) => call.request.action === "stop")).toHaveLength(1);
  });
});
