import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: {
    provider: "local" as const,
    user: { id: "00000000-0000-4000-8000-000000000001", name: "David", email: "david@example.test" },
    tenant: { id: "connector-qa", name: "Connector QA" },
    expiresAt: "2026-08-29T00:00:00.000Z",
  },
  sameOrigin: true,
  readConnectorApproval: vi.fn(),
  approveConnectorApprovalByLocator: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({ getSession: async () => mocks.session }));
vi.mock("@/auth/request-security", () => ({ isSameOriginMutation: async () => mocks.sameOrigin }));
vi.mock("@/config/installation", () => ({
  loadInstallationConfig: async () => ({
    installationId: "connector-qa",
    paths: { usersRoot: "/tmp/aibrain-connector-approval-route/users" },
  }),
}));
vi.mock("@/operations/server-logger", () => ({
  operationalLogger: { warn: vi.fn() },
}));
vi.mock("@/runtime/approval-store", () => ({
  FileApprovalStore: class FileApprovalStore {
    readConnectorApproval = mocks.readConnectorApproval;
    approveConnectorApprovalByLocator = mocks.approveConnectorApprovalByLocator;
    resolve = mocks.resolve;
  },
}));

import { POST } from "@/app/api/runtime/approvals/route";

const fingerprint = "a".repeat(64);
const routing = {
  approvalId: "connector-approval-1",
  threadId: "thread-connector-1",
  turnId: "turn-connector-1",
  itemId: "item-connector-1",
};

function request(body: unknown) {
  return new Request("https://brain.example/api/runtime/approvals", {
    method: "POST",
    headers: { Origin: "https://brain.example", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("runtime connector approval route", () => {
  beforeEach(() => {
    mocks.session = {
      provider: "local",
      user: { id: "00000000-0000-4000-8000-000000000001", name: "David", email: "david@example.test" },
      tenant: { id: "connector-qa", name: "Connector QA" },
      expiresAt: "2026-08-29T00:00:00.000Z",
    };
    mocks.sameOrigin = true;
    mocks.readConnectorApproval.mockReset();
    mocks.approveConnectorApprovalByLocator.mockReset();
    mocks.resolve.mockReset();
    mocks.readConnectorApproval.mockResolvedValue(null);
    mocks.approveConnectorApprovalByLocator.mockResolvedValue({ outcome: "approved" });
    mocks.resolve.mockResolvedValue({ outcome: "resolved" });
  });

  it("accepts one connector action using only session-scoped routing and the visible fingerprint", async () => {
    mocks.readConnectorApproval.mockResolvedValue({ status: "approval_requested" });
    const response = await POST(request({ ...routing, decision: "accept", authorizationFingerprint: fingerprint }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "approved" });
    const expectedLocator = {
      installationId: "connector-qa",
      userId: mocks.session.user.id,
      threadId: routing.threadId,
      turnId: routing.turnId,
      itemId: routing.itemId,
      approvalId: routing.approvalId,
    };
    expect(mocks.readConnectorApproval).toHaveBeenCalledWith(expectedLocator);
    expect(mocks.approveConnectorApprovalByLocator).toHaveBeenCalledWith(expectedLocator, fingerprint);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("rejects decline, acceptForSession, cancel, and client-supplied receipts for connector approvals", async () => {
    mocks.readConnectorApproval.mockResolvedValue({ status: "approval_requested" });
    expect((await POST(request({ ...routing, decision: "decline" }))).status).toBe(403);
    expect((await POST(request({ ...routing, decision: "acceptForSession" }))).status).toBe(403);
    expect((await POST(request({ ...routing, decision: "cancel" }))).status).toBe(400);
    expect((await POST(request({
      ...routing,
      decision: "accept",
      authorizationFingerprint: fingerprint,
      receiptId: "b".repeat(64),
    }))).status).toBe(403);
    expect(mocks.approveConnectorApprovalByLocator).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("is idempotent for an approved retry and fails closed on a fingerprint mismatch", async () => {
    mocks.readConnectorApproval.mockResolvedValue({ status: "approved" });
    mocks.approveConnectorApprovalByLocator.mockResolvedValueOnce({ outcome: "already-approved" });
    const replay = await POST(request({ ...routing, decision: "accept", authorizationFingerprint: fingerprint }));
    expect(replay.status).toBe(200);

    mocks.approveConnectorApprovalByLocator.mockResolvedValueOnce({ outcome: "denied" });
    const mismatched = await POST(request({ ...routing, decision: "accept", authorizationFingerprint: "b".repeat(64) }));
    expect(mismatched.status).toBe(403);
  });

  it("cannot resolve another employee's connector approval", async () => {
    mocks.session = {
      ...mocks.session,
      user: { id: "00000000-0000-4000-8000-000000000002", name: "Arnau", email: "arnau@example.test" },
    };
    mocks.readConnectorApproval.mockResolvedValue(null);
    mocks.resolve.mockResolvedValue({ outcome: "not-found" });
    const response = await POST(request({ ...routing, decision: "accept" }));
    expect(response.status).toBe(404);
    expect(mocks.approveConnectorApprovalByLocator).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ userId: mocks.session.user.id }), "accept");
  });
});
