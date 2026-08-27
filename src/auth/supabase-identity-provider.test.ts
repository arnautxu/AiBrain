import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthIdentityProvider } from "@/auth/supabase-identity-provider";

vi.mock("server-only", () => ({}));

const provider = () => new SupabaseAuthIdentityProvider({
  url: "http://127.0.0.1:54321",
  publishableKey: "synthetic-publishable-key",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SupabaseAuthIdentityProvider failures", () => {
  it("classifies a network outage as provider unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection refused")));
    await expect(provider().verifyPassword("employee@example.test", "Temporary-pass-123"))
      .rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("keeps a provider credential rejection distinct from an outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "invalid_grant",
      error_description: "invalid credentials",
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })));
    await expect(provider().verifyPassword("employee@example.test", "wrong-password"))
      .rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("updates a password with the challenge access token without rotating its refresh token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "00000000-0000-4000-8000-000000000001",
      email: "employee@example.test",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await provider().updatePassword({
      accessToken: "challenge-access-token",
      refreshToken: "challenge-refresh-token",
    }, "Permanent-pass-789");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:54321/auth/v1/user");
    expect(request.method).toBe("PUT");
    expect(request.headers).toMatchObject({
      apikey: "synthetic-publishable-key",
      Authorization: "Bearer challenge-access-token",
    });
    expect(JSON.parse(String(request.body))).toEqual({ password: "Permanent-pass-789" });
    expect(JSON.stringify(request)).not.toContain("challenge-refresh-token");
  });

  it("keeps password rejections distinct from provider outages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "weak_password",
      message: "Password is too weak",
    }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })));
    await expect(provider().updatePassword({
      accessToken: "challenge-access-token",
      refreshToken: "challenge-refresh-token",
    }, "Permanent-pass-789")).rejects.toMatchObject({ code: "provider_rejected" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(provider().updatePassword({
      accessToken: "challenge-access-token",
      refreshToken: "challenge-refresh-token",
    }, "Permanent-pass-789")).rejects.toMatchObject({ code: "provider_unavailable" });
  });
});
