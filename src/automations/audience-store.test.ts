import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileAutomationAudienceStore } from "@/automations/audience-store";

vi.mock("server-only", () => ({}));

const roots: string[] = [];
const delivery = {
  runKey: "10000000-0000-4000-8000-000000000001:2026-08-30T09:00:00.000Z",
  taskId: "10000000-0000-4000-8000-000000000001",
  ownerUserId: "00000000-0000-4000-8000-000000000001",
  projectId: "20000000-0000-4000-8000-000000000001",
  threadId: "30000000-0000-4000-8000-000000000001",
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileAutomationAudienceStore", () => {
  it("records one delivery across retry and restart", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "aibrain-audience-delivery-"));
    roots.push(dataRoot);
    const now = () => Date.parse("2026-08-30T09:00:00.000Z");
    const first = new FileAutomationAudienceStore({ installationId: "audience-qa", dataRoot, now });
    const initial = await first.record(delivery);
    const retried = await first.record(delivery);
    const restarted = new FileAutomationAudienceStore({ installationId: "audience-qa", dataRoot, now });

    expect(retried).toEqual(initial);
    expect(await restarted.list()).toEqual([initial]);
    expect(await restarted.findByThread(delivery.threadId)).toEqual(initial);
  });

  it("fails closed if a run key or thread is rebound", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "aibrain-audience-delivery-"));
    roots.push(dataRoot);
    const store = new FileAutomationAudienceStore({ installationId: "audience-qa", dataRoot });
    await store.record(delivery);
    await expect(store.record({ ...delivery, threadId: "30000000-0000-4000-8000-000000000002" }))
      .rejects.toMatchObject({ code: "AUTOMATION_DELIVERY_CONFLICT" });
    await expect(store.record({ ...delivery, runKey: `${delivery.runKey}:retry` }))
      .rejects.toMatchObject({ code: "AUTOMATION_DELIVERY_CONFLICT" });
  });
});
