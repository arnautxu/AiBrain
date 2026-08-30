import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallationConfig } from "@/config/installation-schema";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  search: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/connectors/gmail-server-service", () => ({ gmailAccessForIdentity: mocks.access }));
vi.mock("@/connectors/gmail-api", () => ({ searchGmail: mocks.search, readGmailMessage: mocks.read }));

import { handleGmailDynamicToolCall } from "@/runtime/gmail-dynamic-tools";

const config = { installationId: "company-qa" } as InstallationConfig;
const params = {
  threadId: "runtime-thread",
  turnId: "runtime-turn",
  callId: "call-1",
  namespace: "aibrain_gmail",
  tool: "search",
  arguments: { query: "from:person@example.com", maxResults: 5 },
} as const;
const context = {
  config,
  installationId: "company-qa",
  userId: "11111111-1111-4111-8111-111111111111",
  runtimeThreadId: "runtime-thread",
  runtimeTurnId: "runtime-turn",
  gmailSelected: true,
};

describe("Gmail dynamic tool authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ accessToken: "access-token-value", binding: {} });
    mocks.search.mockResolvedValue({ messages: [], resultSizeEstimate: 0 });
  });

  it("does not touch credentials unless @gmail was authorized for this exact turn", async () => {
    await expect(handleGmailDynamicToolCall(params, { ...context, gmailSelected: false })).resolves.toMatchObject({ success: false });
    await expect(handleGmailDynamicToolCall(params, { ...context, runtimeTurnId: "another-turn" })).resolves.toMatchObject({ success: false });
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("resolves only the authenticated employee token after identity checks", async () => {
    await expect(handleGmailDynamicToolCall(params, context)).resolves.toMatchObject({ success: true });
    expect(mocks.access).toHaveBeenCalledWith(config, context.userId, undefined);
    expect(mocks.search).toHaveBeenCalledWith(fetch, "access-token-value", "from:person@example.com", 5);
  });
});
