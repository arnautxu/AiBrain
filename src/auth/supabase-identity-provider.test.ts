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
});
