import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSigningSecret: () => "test-signing-secret-with-at-least-thirty-two-bytes",
}));

import { issueThreadToken, readThreadToken } from "@/runtime/thread-token";

describe("runtime thread token", () => {
  const userA = "00000000-0000-4000-8000-000000000001";
  const userB = "00000000-0000-4000-8000-000000000002";

  it("binds a resumable Codex thread to installation and employee", () => {
    const token = issueThreadToken("qa-company", userA, "runtime-thread-1");
    expect(readThreadToken(token, "qa-company", userA)).toBe("runtime-thread-1");
    expect(readThreadToken(token, "qa-company", userB)).toBeNull();
    expect(readThreadToken(token, "other-company", userA)).toBeNull();
  });

  it("rejects tampering and invalid runtime identifiers", () => {
    const token = issueThreadToken("qa-company", userA, "runtime-thread-1");
    expect(readThreadToken(`${token}x`, "qa-company", userA)).toBeNull();
    expect(() => issueThreadToken("qa-company", userA, "../escape")).toThrow();
  });
});
