import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallationConfig } from "@/config/installation-schema";

const mocks = vi.hoisted(() => ({ access: vi.fn(), search: vi.fn(), read: vi.fn() }));
vi.mock("@/connectors/outlook-server-service", () => ({ outlookAccessForIdentity: mocks.access }));
vi.mock("@/connectors/outlook-api", () => ({ searchOutlookMessages: mocks.search, readOutlookMessage: mocks.read }));
import { handleOutlookDynamicToolCall } from "@/runtime/outlook-dynamic-tools";

const config = { installationId: "company-qa" } as InstallationConfig;
const params = { threadId: "runtime-thread", turnId: "runtime-turn", callId: "call-1", namespace: "aibrain_outlook", tool: "search", arguments: { query: "quarterly review", maxResults: 5 } } as const;
const context = { config, installationId: "company-qa", userId: "11111111-1111-4111-8111-111111111111", runtimeThreadId: "runtime-thread", runtimeTurnId: "runtime-turn", outlookSelected: true };

describe("Outlook dynamic tool authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ accessToken: "access-token-value", binding: {} }); mocks.search.mockResolvedValue({ messages: [] }); });

  it("does not touch credentials unless @outlook was authorized for this exact turn", async () => {
    await expect(handleOutlookDynamicToolCall(params, { ...context, outlookSelected: false })).resolves.toMatchObject({ success: false });
    await expect(handleOutlookDynamicToolCall(params, { ...context, runtimeTurnId: "another-turn" })).resolves.toMatchObject({ success: false });
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("resolves only the authenticated employee token after identity checks", async () => {
    await expect(handleOutlookDynamicToolCall(params, context)).resolves.toMatchObject({ success: true });
    expect(mocks.access).toHaveBeenCalledWith(config, context.userId, undefined);
    expect(mocks.search).toHaveBeenCalledWith(fetch, "access-token-value", "quarterly review", 5);
  });
});
