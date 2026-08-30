import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserActionHistoryStore } from "@/runtime/browser/action-history";

const USER_A = "0198b9f0-6631-7000-8000-000000000701";
const USER_B = "0198b9f0-6631-7000-8000-000000000702";
const THREAD_A = "0198b9f0-6631-7000-8000-000000000711";
const roots: string[] = [];

async function userRoot(userId: string) {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-browser-history-"));
  roots.push(root);
  const user = path.join(root, userId);
  await mkdir(user, { mode: 0o700 });
  await chmod(user, 0o700);
  return user;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("BrowserActionHistoryStore", () => {
  it("keeps a bounded secret-free action projection scoped to one user and thread", async () => {
    const store = new BrowserActionHistoryStore({ userRoot: await userRoot(USER_A) });
    const common = {
      schemaVersion: 1 as const,
      installationId: "browser-lab",
      userId: USER_A,
      threadId: THREAD_A,
      turnId: "turn-1",
      callId: "call-1",
      action: "type" as const,
      actor: "agent" as const,
    };
    await store.append({ ...common, phase: "started", success: null });
    await store.append({ ...common, phase: "completed", success: true });
    await store.append({ ...common, phase: "completed", success: true });

    const history = await store.list(THREAD_A);
    expect(history).toHaveLength(2);
    expect(history.map((item) => item.phase)).toEqual(["completed", "started"]);
    expect(JSON.stringify(history)).not.toContain("secret");
    expect(JSON.stringify(history)).not.toContain("arguments");
  });

  it("does not cross users and rejects traversal-shaped thread queries", async () => {
    const rootA = await userRoot(USER_A);
    const rootB = await userRoot(USER_B);
    const storeA = new BrowserActionHistoryStore({ userRoot: rootA });
    const storeB = new BrowserActionHistoryStore({ userRoot: rootB });
    await storeA.append({
      schemaVersion: 1,
      installationId: "browser-lab",
      userId: USER_A,
      threadId: THREAD_A,
      turnId: "turn-a",
      callId: "call-a",
      action: "read",
      phase: "completed",
      success: true,
      actor: "agent",
    });
    await expect(storeB.list(THREAD_A)).resolves.toEqual([]);
    await expect(storeB.append({
      schemaVersion: 1,
      installationId: "browser-lab",
      userId: USER_A,
      threadId: THREAD_A,
      turnId: "manual-takeover",
      callId: "manual-call",
      action: "click",
      phase: "dispatched",
      success: true,
      actor: "human",
    })).rejects.toThrow("user binding is invalid");
    await expect(storeA.list("../../foreign")).rejects.toThrow("query is invalid");
  });
});
