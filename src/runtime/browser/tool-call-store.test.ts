import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicTemporaryPath } from "@/storage";
import {
  BrowserToolCallStore,
  type BrowserToolCallIdentity,
} from "@/runtime/browser/tool-call-store";

const roots: string[] = [];
const USER_ID = "11a11111-1111-4111-8111-111111111111";

function identity(callId: string): BrowserToolCallIdentity {
  return {
    installationId: "browser-tools-test",
    userId: USER_ID,
    threadId: "thread-a",
    turnId: "turn-a",
    callId,
    tool: "read",
    argumentsHash: "a".repeat(64),
    permissionFingerprint: "b".repeat(64),
  };
}

async function fixture(options: { maxRecords?: number; maxRecordBytes?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-browser-tool-store-"));
  roots.push(root);
  const userRoot = path.join(root, "users", USER_ID);
  await mkdir(userRoot, { recursive: true, mode: 0o700 });
  return new BrowserToolCallStore({ userRoot, ...options });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("BrowserToolCallStore capacity and recovery", () => {
  it("replays an existing call but applies global record backpressure to a new call", async () => {
    const store = await fixture({ maxRecords: 1 });
    const first = identity("call-first");
    await store.begin(first);
    await expect(store.begin(first)).resolves.toMatchObject({ callId: "call-first" });
    await expect(store.begin(identity("call-second"))).rejects.toMatchObject({
      code: "BROWSER_TOOL_CAPACITY",
    });
  });

  it("recovers an interrupted atomic record before deduplicating its replay", async () => {
    const store = await fixture();
    const call = identity("call-recover");
    await store.begin(call);
    const [recordName] = (await readdir(store.recordsRoot)).filter((name) => name.endsWith(".json"));
    const recordPath = path.join(store.recordsRoot, recordName as string);
    await rename(recordPath, atomicTemporaryPath(recordPath, "interrupted-write"));

    await expect(store.begin(call)).resolves.toMatchObject({ callId: "call-recover", status: "pending" });
    expect((await readdir(store.recordsRoot)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });

  it("rejects an oversized completed screenshot without replacing the executing record", async () => {
    const store = await fixture({ maxRecordBytes: 4_096 });
    const call = identity("call-large-frame");
    await store.begin(call);
    await store.markExecuting(call);
    await expect(store.complete(call, {
      success: true,
      contentItems: [{
        type: "inputImage",
        imageUrl: `data:image/png;base64,${"A".repeat(8_192)}`,
      }],
    })).rejects.toMatchObject({ code: "BROWSER_TOOL_CAPACITY" });
    await expect(store.markExecuting(call)).resolves.toMatchObject({
      acquired: false,
      record: expect.objectContaining({ status: "executing", response: null }),
    });
  });
});
