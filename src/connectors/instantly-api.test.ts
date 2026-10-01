import { describe, expect, it, vi } from "vitest";
import { instantlyRead } from "@/connectors/instantly-api";
const workspace = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
function provider(values: unknown[]) { const f = vi.fn(); for (const v of values) f.mockResolvedValueOnce(Response.json(v)); return f; }
describe("Instantly bounded read-only adapter", () => {
  it("checks the authenticated workspace before reading any data", async () => {
    const f = provider([{ id: foreign }]);
    await expect(instantlyRead(f, "private-key", workspace, "accounts")).rejects.toMatchObject({ code: "INSTANTLY_WORKSPACE_MISMATCH" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("does not expose account credentials or unreviewed fields", async () => {
    const f = provider([{ id: workspace }, { items: [{ organization: workspace, email: "test@acme.test", status: 1, smtp_password: "private-password", token: "private-token", warmup: { password: "bad" } }], next_starting_after: "cursor" }]);
    const result = await instantlyRead(f, "private-key", workspace, "accounts", { limit: 5 });
    expect(result).toMatchObject({ workspaceId: workspace, nextCursor: "cursor", items: [{ email: "test@acme.test", status: 1 }] });
    expect(JSON.stringify(result)).not.toMatch(/private-key|private-password|private-token|password|token/);
    expect(f.mock.calls.every(([, options]) => options.redirect === "error")).toBe(true);
  });
  it("fails closed on a foreign returned record and on mutation or URL arguments", async () => {
    const f = provider([{ id: workspace }, { items: [{ organization: foreign }] }]);
    await expect(instantlyRead(f, "key", workspace, "leads")).rejects.toMatchObject({ code: "INSTANTLY_WORKSPACE_MISMATCH" });
    const denied = provider([]);
    await expect(instantlyRead(denied, "key", workspace, "activate" as never)).rejects.toMatchObject({ code: "INSTANTLY_ARGUMENTS_INVALID" });
    await expect(instantlyRead(denied, "key", workspace, "accounts", { url: "https://foreign.test" })).rejects.toMatchObject({ code: "INSTANTLY_ARGUMENTS_INVALID" });
    expect(denied).not.toHaveBeenCalled();
  });
  it("restricts warmup analytics to owned accounts without changing warmup", async () => {
    const f = provider([{ id: workspace }, { items: [{ organization: workspace, email: "own@acme.test" }] }]);
    await expect(instantlyRead(f, "key", workspace, "warmup", { emails: ["foreign@else.test"] })).rejects.toMatchObject({ code: "INSTANTLY_ACCOUNT_DENIED" });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("returns empty replies and numeric metrics honestly", async () => {
    const f = provider([{ id: workspace }, { items: [] }]);
    expect(await instantlyRead(f, "key", workspace, "replies")).toMatchObject({ items: [] });
    expect(f.mock.calls[1][0]).toContain("email_type=received");
    const metrics = provider([{ id: workspace }, { reply_count: 0, emails_sent_count: 0, token: "hidden" }]);
    expect(await instantlyRead(metrics, "key", workspace, "metrics")).toMatchObject({ metrics: { reply_count: 0, emails_sent_count: 0 } });
  });
  it("redacts provider errors and never retries uncertain requests", async () => {
    const f = vi.fn().mockResolvedValue(new Response("secret error", { status: 401 }));
    await expect(instantlyRead(f, "key", workspace, "workspace")).rejects.toMatchObject({ code: "INSTANTLY_HTTP_401" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
