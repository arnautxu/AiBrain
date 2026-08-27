import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  check: vi.fn(),
  login: vi.fn(),
  requestPasswordRecovery: vi.fn(),
  completePasswordRecovery: vi.fn(),
  changeInitialPassword: vi.fn(),
  clearAuthChallengeCookie: vi.fn(),
  challengeId: "initial-password-challenge-secret",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/request-security", () => ({
  isSameOriginMutation: async () => true,
}));
vi.mock("@/auth/rate-limit-context", () => ({
  checkAuthRateLimit: (...args: unknown[]) => mocked.check(...args),
}));
vi.mock("@/auth/auth-context", () => ({
  createLocalAuthService: async () => ({
    login: mocked.login,
    requestPasswordRecovery: mocked.requestPasswordRecovery,
    completePasswordRecovery: mocked.completePasswordRecovery,
    changeInitialPassword: mocked.changeInitialPassword,
  }),
}));
vi.mock("@/auth/public-url", () => ({
  getPublicOrigin: async () => "https://brain.example.test",
}));
vi.mock("@/auth/session", () => ({
  getAuthMode: () => "supabase",
  createDemoSession: async () => null,
}));
vi.mock("@/auth/session-cookie", () => ({
  LOCAL_AUTH_CHALLENGE_COOKIE: "aibrain_auth_challenge",
  clearAuthChallengeCookie: (...args: unknown[]) => mocked.clearAuthChallengeCookie(...args),
  setAuthChallengeCookie: async () => undefined,
  setLocalSessionCookie: async () => undefined,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => ({ value: mocked.challengeId }),
  }),
}));

import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as recoveryPost } from "@/app/api/auth/password/recovery/route";
import { POST as resetRequestPost } from "@/app/api/auth/password/reset/request/route";
import { POST as initialChangePost } from "@/app/api/auth/password/change-initial/route";
import { IdentityProviderError } from "@/auth/identity-provider";

function request(pathname: string, body: Record<string, unknown>) {
  return new Request(`https://brain.example.test${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "192.0.2.50",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.check.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
});

describe("auth route rate limits", () => {
  it("returns 429 with retry metadata before calling the login provider", async () => {
    mocked.check.mockResolvedValue({ allowed: false, retryAfterSeconds: 321 });
    const response = await loginPost(request("/api/auth/login", {
      email: "Person@Example.test",
      password: "wrong-password",
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("321");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocked.login).not.toHaveBeenCalled();
    expect(mocked.check).toHaveBeenCalledWith(
      expect.any(Request),
      "login",
      "email:person@example.test",
    );
  });

  it("keeps password-reset requests indistinguishable and never calls the provider when limited", async () => {
    mocked.check.mockResolvedValue({ allowed: false, retryAfterSeconds: 1_800 });
    const response = await resetRequestPost(request("/api/auth/password/reset/request", {
      email: "person@example.test",
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocked.requestPasswordRecovery).not.toHaveBeenCalled();

    mocked.check.mockRejectedValue(new Error("corrupt bucket"));
    const unavailable = await resetRequestPost(request("/api/auth/password/reset/request", {
      email: "other@example.test",
    }));
    expect(unavailable.status).toBe(202);
    expect(await unavailable.json()).toEqual({ accepted: true });
    expect(mocked.requestPasswordRecovery).not.toHaveBeenCalled();
  });

  it("limits recovery proof completion before verifying the code or token", async () => {
    mocked.check.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });
    const response = await recoveryPost(request("/api/auth/password/recovery", {
      code: "provider-recovery-code",
      password: "Permanent-pass-123",
      confirmation: "Permanent-pass-123",
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(mocked.completePasswordRecovery).not.toHaveBeenCalled();
    expect(mocked.check).toHaveBeenCalledWith(
      expect.any(Request),
      "password-recovery-complete",
      "code:provider-recovery-code",
    );
  });

  it("limits initial password changes by client and opaque challenge subject", async () => {
    mocked.check.mockResolvedValue({ allowed: false, retryAfterSeconds: 600 });
    const response = await initialChangePost(request("/api/auth/password/change-initial", {
      password: "Permanent-pass-123",
      confirmation: "Permanent-pass-123",
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(mocked.changeInitialPassword).not.toHaveBeenCalled();
    expect(mocked.check).toHaveBeenCalledWith(
      expect.any(Request),
      "initial-password-change",
      `challenge:${mocked.challengeId}`,
    );
  });

  it("keeps a provider password rejection retryable instead of expiring the challenge", async () => {
    mocked.changeInitialPassword.mockRejectedValue(new IdentityProviderError(
      "provider_rejected",
      "provider rejected password",
    ));
    const response = await initialChangePost(request("/api/auth/password/change-initial", {
      password: "Permanent-pass-123",
      confirmation: "Permanent-pass-123",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "El proveïdor ha rebutjat la contrasenya. Tria una contrasenya diferent i torna-ho a provar.",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocked.clearAuthChallengeCookie).not.toHaveBeenCalled();
  });
});
