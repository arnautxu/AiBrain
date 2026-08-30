import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSigningSecret: () => "test-signing-secret-with-at-least-thirty-two-bytes",
}));

import { createHmac } from "node:crypto";
import {
  CURRENT_THREAD_TOOLSET_REVISION,
  issueThreadToken,
  readThreadToken,
  readThreadTokenContext,
  toolsetRevisionForIssuedThreadToken,
} from "@/runtime/thread-token";

describe("runtime thread token", () => {
  const userA = "00000000-0000-4000-8000-000000000001";
  const userB = "00000000-0000-4000-8000-000000000002";

  it("binds a resumable Codex thread to installation and employee", () => {
    const token = issueThreadToken("qa-company", userA, "runtime-thread-1");
    expect(readThreadToken(token, "qa-company", userA)).toBe("runtime-thread-1");
    expect(readThreadTokenContext(token, "qa-company", userA)).toEqual({
      threadId: "runtime-thread-1",
      toolsetRevision: CURRENT_THREAD_TOOLSET_REVISION,
    });
    expect(readThreadToken(token, "qa-company", userB)).toBeNull();
    expect(readThreadToken(token, "other-company", userA)).toBeNull();
  });

  it("rejects tampering and invalid runtime identifiers", () => {
    const token = issueThreadToken("qa-company", userA, "runtime-thread-1");
    expect(readThreadToken(`${token}x`, "qa-company", userA)).toBeNull();
    expect(() => issueThreadToken("qa-company", userA, "../escape")).toThrow();
  });

  it("accepts legacy resumable threads while marking their dynamic toolset stale", () => {
    const payload = Buffer.from(JSON.stringify({
      version: 2,
      tenantId: "qa-company",
      userId: userA,
      threadId: "runtime-thread-legacy",
      expiresAt: Date.now() + 60_000,
    })).toString("base64url");
    const signature = createHmac("sha256", "test-signing-secret-with-at-least-thirty-two-bytes")
      .update(`thread:${payload}`)
      .digest("base64url");
    expect(readThreadTokenContext(`${payload}.${signature}`, "qa-company", userA)).toEqual({
      threadId: "runtime-thread-legacy",
      toolsetRevision: null,
    });
  });

  it("keeps a resumed legacy thread stale until a new tool-enabled thread starts", () => {
    expect(toolsetRevisionForIssuedThreadToken("runtime-thread-legacy", null)).toBeNull();
    expect(readThreadTokenContext(
      issueThreadToken("qa-company", userA, "runtime-thread-legacy", null),
      "qa-company",
      userA,
    )).toEqual({ threadId: "runtime-thread-legacy", toolsetRevision: null });
    expect(toolsetRevisionForIssuedThreadToken(null, null)).toBe(CURRENT_THREAD_TOOLSET_REVISION);
  });
});
