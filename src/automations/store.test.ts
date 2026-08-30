import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("migrates legacy tasks to an explicit owner-only audience without changing their ids", async () => {
    const usersRoot = await root();
    const now = () => Date.parse("2026-08-28T08:00:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now });
    const created = await store.create(input("2026-08-28T09:00:00.000Z"));
    const legacy = JSON.parse(await readFile(store.tasksPath, "utf8")) as { tasks: Array<Record<string, unknown>> };
    delete legacy.tasks[0]?.audience;
    await writeFile(store.tasksPath, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });

    const [migrated] = await new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now }).list();
    expect(migrated).toMatchObject({ id: created.id, audience: { membershipPolicy: "current", userIds: [userA], groupIds: [] } });
    expect(JSON.parse(await readFile(store.tasksPath, "utf8")).tasks[0].audience)
      .toEqual({ membershipPolicy: "current", userIds: [userA], groupIds: [] });
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
      maxAttempts: 1,
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

  it("persists exponential retries with the same idempotency key", async () => {
    const usersRoot = await root();
    let clock = Date.parse("2026-08-28T09:00:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now: () => clock });
    await store.create(input("2026-08-28T09:00:00.000Z"));
    const first = await runAutomationSweep({
      store,
      ownerId: "worker-one",
      now: () => clock,
      retryBaseMs: 1_000,
      execute: async () => { throw new Error("transient"); },
    });
    expect(first).toMatchObject([{ status: "failed", error: "transient" }]);
    const [pending] = await store.list();
    expect(pending.retryAt).toBe("2026-08-28T09:00:01.000Z");
    const firstRunKey = (await store.listRuns())[0].runKey;
    clock += 1_000;
    await runAutomationSweep({
      store,
      ownerId: "worker-two",
      now: () => clock,
      retryBaseMs: 1_000,
      execute: async () => ({ threadId: projectId }),
    });
    const runs = await store.listRuns();
    expect(runs.at(-1)).toMatchObject({ runKey: firstRunKey, status: "succeeded", attempt: 2 });
    expect((await store.list())[0].state).toBe("completed");
  });

  it("fences a stale worker after a recovered lease", async () => {
    const usersRoot = await root();
    let clock = Date.parse("2026-08-28T09:00:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now: () => clock, leaseMs: 1_000 });
    await store.create(input("2026-08-28T09:00:00.000Z"));
    const [first] = await store.claimDue("worker-one");
    clock += 1_001;
    const [second] = await store.claimDue("worker-two");
    await expect(store.renewLease(first)).rejects.toMatchObject({ code: "AUTOMATION_LEASE_LOST" });
    await store.settle(second, { status: "succeeded" });
    expect((await store.list())[0].state).toBe("completed");
  });

  it("runs independent claims concurrently but never duplicates their run key", async () => {
    const usersRoot = await root();
    const clock = Date.parse("2026-08-28T09:00:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now: () => clock });
    await store.create(input("2026-08-28T09:00:00.000Z"));
    await store.create({ ...input("2026-08-28T09:00:00.000Z"), name: "Segundo" });
    let running = 0;
    let maximum = 0;
    await runAutomationSweep({
      store,
      ownerId: "worker-one",
      concurrency: 2,
      now: () => clock,
      execute: async () => {
        running += 1;
        maximum = Math.max(maximum, running);
        await new Promise((resolve) => setTimeout(resolve, 200));
        running -= 1;
        return { threadId: projectId };
      },
    });
    expect(maximum).toBe(2);
    expect(new Set((await store.listRuns()).filter((run) => run.status === "succeeded").map((run) => run.runKey)).size).toBe(2);
  });

  it("cancels an in-flight deletion without retrying and retains its durable history", async () => {
    const usersRoot = await root();
    const clock = Date.parse("2026-08-28T09:00:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now: () => clock });
    const task = await store.create(input("2026-08-28T09:00:00.000Z"));
    let started!: () => void;
    const executing = new Promise<void>((resolve) => { started = resolve; });
    const sweep = runAutomationSweep({
      store,
      ownerId: "worker-one",
      now: () => clock,
      leaseRenewalMs: 1,
      execute: async (_claim, _threadId, _prepared, signal) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        return { threadId: projectId };
      },
    });
    await executing;
    await store.delete(task.id);
    await sweep;

    expect(await store.list()).toEqual([]);
    const history = await store.listRuns(task.id);
    expect(history.at(-1)).toMatchObject({ status: "failed", attempt: 1, error: "La automatización fue cancelada por su propietario." });
    expect(history.filter((run) => run.status === "running")).toHaveLength(1);
  });

  it("fences an in-flight claim when its runtime inputs change", async () => {
    const usersRoot = await root();
    const clock = Date.parse("2026-08-28T09:00:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now: () => clock });
    const task = await store.create(input("2026-08-28T09:00:00.000Z"));
    const [claim] = await store.claimDue("worker-one");
    await store.update(task.id, { prompt: "Genera el informe únicamente con cifras aprobadas." });
    await expect(store.renewLease(claim)).rejects.toMatchObject({ code: "AUTOMATION_CANCELLED" });
    expect((await store.list())[0]).toMatchObject({ state: "active", cancellationRequestedAt: expect.any(String) });
  });

  it("persists the prepared result thread in the durable run history", async () => {
    const usersRoot = await root();
    const clock = Date.parse("2026-08-28T09:00:00.000Z");
    const store = new FileAutomationStore({ installationId: "tenant-one", userId: userA, usersRoot, now: () => clock });
    await store.create(input("2026-08-28T09:00:00.000Z"));
    await runAutomationSweep({
      store,
      ownerId: "offline-worker",
      now: () => clock,
      execute: async (_claim, _threadId, prepared) => {
        await prepared(projectId);
        return { threadId: projectId };
      },
    });

    expect((await store.listRuns()).at(-1)).toMatchObject({ status: "succeeded", threadId: projectId });
  });
});
