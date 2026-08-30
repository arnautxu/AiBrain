import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/auth/types";

const USER_A = "0198b9f0-6631-7000-8000-000000000601";
const USER_B = "0198b9f0-6631-7000-8000-000000000602";
const THREAD_A = "0198b9f0-6631-7000-8000-000000000611";
const THREAD_B = "0198b9f0-6631-7000-8000-000000000612";
const auth = vi.hoisted(() => ({
  value: null as { session: AuthSession; authSessionId: string } | null,
}));
const browser = vi.hoisted(() => ({
  status: vi.fn(),
  control: vi.fn(),
  issue: vi.fn(),
  frame: vi.fn(),
  command: vi.fn(),
  history: vi.fn(),
  navigation: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/request-security", () => ({ isSameOriginMutation: vi.fn(async () => true) }));
vi.mock("@/workbench/store", async () => {
  const { WorkbenchNotFoundError } = await import("@/workbench/errors");
  return {
    getThreadRuntimeContext: vi.fn(async (session: AuthSession, threadId: string) => {
      if (session.user.id !== USER_A || threadId !== THREAD_A) {
        throw new WorkbenchNotFoundError("Thread not found.");
      }
      return { threadId, projectId: "0198b9f0-6631-7000-8000-000000000613" };
    }),
  };
});
vi.mock("@/runtime/browser/route-security", () => ({
  getLocalBrowserRequestAuth: vi.fn(async () => auth.value ?? { error: "unauthenticated" }),
  readBrowserBearerToken: vi.fn((request: Request) => {
    const value = request.headers.get("authorization");
    return value?.startsWith("Bearer ") ? value.slice(7) : null;
  }),
}));
vi.mock("@/runtime/browser/server-service", () => ({
  browserStatus: browser.status,
  controlBrowser: browser.control,
  issueBrowserGatewayToken: browser.issue,
  captureBrowserFrame: browser.frame,
  sendBrowserViewerCommand: browser.command,
  browserActionHistory: browser.history,
  browserViewerNavigationState: browser.navigation,
  streamBrowserFrames: browser.stream,
  BrowserServiceError: class BrowserServiceError extends Error {},
}));

function localSession(userId: string): AuthSession {
  return {
    provider: "local",
    user: {
      id: userId,
      name: "Browser User",
      email: "browser@example.test",
    },
    tenant: { id: "browser-lab", name: "Browser Lab" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function request(path: string, body?: unknown, token?: string) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  auth.value = {
    session: localSession(USER_A),
    authSessionId: "opaque-local-auth-session-00000000000000000001",
  };
  browser.status.mockReset().mockResolvedValue({ healthy: false, runningInProcess: false });
  browser.control.mockReset().mockResolvedValue({ healthy: true, runningInProcess: true });
  browser.issue.mockReset().mockResolvedValue({ token: "payload.signature", browserSessionId: "browser-session" });
  browser.frame.mockReset().mockResolvedValue({
    schemaVersion: 1,
    mediaType: "image/png",
    dataBase64: Buffer.from("png-frame").toString("base64"),
    capturedAt: "2026-08-27T00:00:00.000Z",
  });
  browser.command.mockReset().mockResolvedValue(undefined);
  browser.history.mockReset().mockResolvedValue([]);
  browser.navigation.mockReset().mockResolvedValue({
    url: "https://example.test/current",
    canGoBack: true,
    canGoForward: false,
  });
  browser.stream.mockReset().mockImplementation(async function* () {
    yield {
      kind: "frame",
      sequence: 1,
      capturedAt: "2026-08-30T10:00:00.000Z",
      captureDurationMs: 24,
      mediaType: "image/png",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
    };
  });
});

describe("authenticated browser runtime routes", () => {
  it("derives runtime ownership only from the local session", async () => {
    const route = await import("@/app/api/runtime/browser/route");
    auth.value = null;
    expect((await route.GET()).status).toBe(401);

    auth.value = {
      session: localSession(USER_A),
      authSessionId: "opaque-local-auth-session-00000000000000000001",
    };
    const response = await route.POST(request("/api/runtime/browser", { action: "start" }));
    expect(response.status).toBe(200);
    expect(browser.control).toHaveBeenCalledWith("browser-lab", USER_A, "start");

    const rejected = await route.POST(request("/api/runtime/browser", {
      action: "stop",
      userId: USER_B,
    }));
    expect(rejected.status).toBe(400);
    expect(browser.control).toHaveBeenCalledTimes(1);
  });

  it("binds viewer tokens to the opaque local auth session", async () => {
    const route = await import("@/app/api/runtime/browser/token/route");
    const response = await route.POST(request("/api/runtime/browser/token", {
      threadId: THREAD_A,
      capabilities: ["view", "control"],
      ttlMs: 30_000,
    }));
    expect(response.status).toBe(200);
    expect(browser.issue).toHaveBeenCalledWith({
      installationId: "browser-lab",
      userId: USER_A,
      authSessionId: "opaque-local-auth-session-00000000000000000001",
      threadId: THREAD_A,
      capabilities: ["control", "view"],
      ttlMs: 30_000,
    });
  });

  it("requires the private bearer binding for frames and human input", async () => {
    const frameRoute = await import("@/app/api/runtime/browser/viewer/frame/route");
    const inputRoute = await import("@/app/api/runtime/browser/viewer/input/route");
    expect((await frameRoute.GET(request(`/api/runtime/browser/viewer/frame?threadId=${THREAD_A}`))).status).toBe(401);

    const frame = await frameRoute.GET(request(
      `/api/runtime/browser/viewer/frame?threadId=${THREAD_A}`,
      undefined,
      "payload.signature",
    ));
    expect(frame.status).toBe(200);
    expect(frame.headers.get("Content-Type")).toBe("image/png");
    expect(await frame.text()).toBe("png-frame");
    expect(browser.frame).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "browser-lab",
      userId: USER_A,
      threadId: THREAD_A,
      token: "payload.signature",
      signal: expect.any(AbortSignal),
    }));

    const input = await inputRoute.POST(request(
      "/api/runtime/browser/viewer/input",
      { threadId: THREAD_A, action: "navigate", url: "https://example.test/path" },
      "payload.signature",
    ));
    expect(input.status).toBe(200);
    expect(browser.command).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_A,
      token: "payload.signature",
      threadId: THREAD_A,
      command: { threadId: THREAD_A, action: "navigate", url: "https://example.test/path" },
      signal: expect.any(AbortSignal),
    }));

    const foreign = await inputRoute.POST(request(
      "/api/runtime/browser/viewer/input",
      { threadId: THREAD_B, action: "navigate", url: "https://example.test" },
      "payload.signature",
    ));
    expect(foreign.status).toBe(404);
  });

  it("streams bounded frames and exposes navigation without leaking runtime details", async () => {
    const streamRoute = await import("@/app/api/runtime/browser/viewer/stream/route");
    const stateRoute = await import("@/app/api/runtime/browser/viewer/state/route");
    const state = await stateRoute.GET(request(
      `/api/runtime/browser/viewer/state?threadId=${THREAD_A}`,
      undefined,
      "payload.signature",
    ));
    expect(await state.json()).toEqual({
      url: "https://example.test/current",
      canGoBack: true,
      canGoForward: false,
    });
    expect(browser.navigation).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_A,
      threadId: THREAD_A,
      signal: expect.any(AbortSignal),
    }));

    const streamed = await streamRoute.GET(request(
      `/api/runtime/browser/viewer/stream?threadId=${THREAD_A}`,
      undefined,
      "payload.signature",
    ));
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get("Content-Type")).toBe("application/vnd.aibrain.browser-frames");
    expect(streamed.headers.get("X-Accel-Buffering")).toBe("no");
    expect((await streamed.arrayBuffer()).byteLength).toBeGreaterThan(8);
    expect(browser.stream).toHaveBeenCalledWith(expect.objectContaining({
      installationId: "browser-lab",
      userId: USER_A,
      threadId: THREAD_A,
      token: "payload.signature",
      signal: expect.any(AbortSignal),
    }));
  });

  it("returns only the authenticated user's history for an owned thread", async () => {
    const route = await import("@/app/api/runtime/browser/history/route");
    const response = await route.GET(request(
      `/api/runtime/browser/history?threadId=${THREAD_A}&limit=25`,
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ history: [] });
    expect(browser.history).toHaveBeenCalledWith("browser-lab", USER_A, THREAD_A, 25);

    const foreign = await route.GET(request(
      `/api/runtime/browser/history?threadId=${THREAD_B}`,
    ));
    expect(foreign.status).toBe(404);
    expect(browser.history).toHaveBeenCalledTimes(1);

    const traversal = await route.GET(request(
      "/api/runtime/browser/history?threadId=../../foreign",
    ));
    expect(traversal.status).toBe(400);
  });
});
