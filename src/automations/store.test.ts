import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAutomationStore } from "@/automations/store";
import { runAutomationSweep } from "@/automations/runner";

const roots: string[] = [];
const projectId = "11111111-1111-4111-8111-111111111111";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function root() {
  const value = await mkdtemp(path.join(tmpdir(), "aibrain-automations-"));
  roots.push(value);
  await mkdir(path.join(value, userA), { recursive: true, mode: 0o700 });
  await mkdir(path.join(value, userB), { recursive: true, mode: 0o700 });
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

function input(runAt: string) {
  return {
    name: "Informe",
    prompt: "Prepara el informe semanal.",
    projectId,
    projectName: "Operaciones",
    timeZone: "Europe/Madrid",
    schedule: { kind: "once" as const, runAt },
  };
}

describe("FileAutomationStore", () => {
  it("isolates tasks and runs by tenant user", async () => {
    const usersRoot = await root();
    const now = () => Date.parse("2026-08-28T08:00:00.000Z");
    const first = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now });
    const second = new FileAutomationStore({ installationId: "tenant-one", userId: userB, usersRoot, now });
    await first.create(input("2026-08-28T09:00:00.000Z"));
    expect(await first.list()).toHaveLength(1);
    expect(await second.list()).toEqual([]);
    expect(await second.listRuns()).toEqual([]);
  });

  it("deduplicates concurrent claims with a filesystem lease", async () => {
    const usersRoot = await root();
    let clock = Date.parse("2026-08-28T08:00:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now: () => clock });
    await store.create(input("2026-08-28T09:00:00.000Z"));
    clock = Date.parse("2026-08-28T09:00:00.000Z");
    const [left, right] = await Promise.all([store.claimDue("worker-left"), store.claimDue("worker-right")]);
    expect(left.length + right.length).toBe(1);
    expect(new Set([...left, ...right].map((claim) => claim.runKey)).size).toBe(1);
  });

  it("records failures and advances a recurring task", async () => {
    const usersRoot = await root();
    let clock = Date.parse("2026-08-28T07:59:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now: () => clock });
    await store.create({ ...input("2026-08-28T09:00:00.000Z"), schedule: { kind: "daily", hour: 10, minute: 0 } });
    clock = Date.parse("2026-08-28T08:00:00.000Z");
    const results = await runAutomationSweep({
      store,
      ownerId: "worker-one",
      now: () => clock,
      execute: async () => { throw new Error("Runtime no disponible"); },
    });
    expect(results).toMatchObject([{ status: "failed", error: "Runtime no disponible" }]);
    const [task] = await store.list();
    expect(task.lastRunStatus).toBe("failed");
    expect(task.nextRunAt).toBe("2026-08-29T08:00:00.000Z");
    expect((await store.listRuns()).map((run) => run.status)).toEqual(["running", "failed"]);
  });

  it("does not execute a terminal run twice after lease recovery", async () => {
    const usersRoot = await root();
    let clock = Date.parse("2026-08-28T08:00:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now: () => clock, leaseMs: 1_000 });
    await store.create(input("2026-08-28T09:00:00.000Z"));
    clock = Date.parse("2026-08-28T09:00:00.000Z");
    const [claim] = await store.claimDue("worker-one");
    await store.appendRun({
      schemaVersion: 1,
      runKey: claim.runKey,
      taskId: claim.task.id,
      installationId: claim.task.installationId,
      userId: claim.task.userId,
      scheduledFor: claim.scheduledFor,
      status: "succeeded",
      attempt: 1,
      startedAt: new Date(clock).toISOString(),
      finishedAt: new Date(clock).toISOString(),
      threadId: projectId,
      error: null,
    });
    clock += 2_000;
    let executions = 0;
    await runAutomationSweep({
      store,
      ownerId: "worker-two",
      now: () => clock,
      execute: async () => { executions += 1; return { threadId: null }; },
    });
    expect(executions).toBe(0);
    expect((await store.list())[0].state).toBe("completed");
  });
});
