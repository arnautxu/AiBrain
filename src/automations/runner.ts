import { hostname } from "node:os";
import type { AutomationRun } from "@/automations/contracts";
import type { FileAutomationStore, ClaimedAutomation } from "@/automations/store";

export type AutomationExecution = (
  claim: ClaimedAutomation,
  existingThreadId: string | null,
  onThreadPrepared: (threadId: string) => Promise<void>,
) => Promise<{ threadId: string | null }>;

export async function runAutomationSweep(options: {
  store: FileAutomationStore;
  execute: AutomationExecution;
  ownerId?: string;
  now?: () => number;
  limit?: number;
}) {
  const now = options.now ?? Date.now;
  const ownerId = options.ownerId ?? `${hostname()}-${process.pid}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
  const claims = await options.store.claimDue(ownerId, options.limit ?? 10);
  const results: { taskId: string; runKey: string; status: "succeeded" | "failed"; error: string | null }[] = [];
  for (const claim of claims) {
    const previous = await options.store.latestRun(claim.runKey);
    if (previous?.status === "succeeded" || previous?.status === "failed") {
      await options.store.settle(claim, { status: previous.status, error: previous.error });
      results.push({ taskId: claim.task.id, runKey: claim.runKey, status: previous.status, error: previous.error });
      continue;
    }
    const attempt = previous ? previous.attempt + 1 : 1;
    const startedAt = new Date(now()).toISOString();
    let threadId = previous?.threadId ?? null;
    await options.store.appendRun({
      schemaVersion: 1,
      runKey: claim.runKey,
      taskId: claim.task.id,
      installationId: claim.task.installationId,
      userId: claim.task.userId,
      scheduledFor: claim.scheduledFor,
      status: "running",
      attempt,
      startedAt,
      finishedAt: null,
      threadId,
      error: null,
    });
    const renewTimer = setInterval(() => {
      void options.store.renewLease(claim).catch(() => undefined);
    }, 60_000);
    renewTimer.unref?.();
    try {
      // The executor creates or reuses a persistent conversation. Its message
      // ids are derived from runKey, so a recovered lease replays one turn.
      const execution = await options.execute(claim, threadId, async (preparedThreadId) => {
        if (threadId === preparedThreadId) return;
        threadId = preparedThreadId;
        await options.store.appendRun({
          schemaVersion: 1,
          runKey: claim.runKey,
          taskId: claim.task.id,
          installationId: claim.task.installationId,
          userId: claim.task.userId,
          scheduledFor: claim.scheduledFor,
          status: "running",
          attempt,
          startedAt,
          finishedAt: null,
          threadId,
          error: null,
        });
      });
      threadId = execution.threadId;
      const run: AutomationRun = {
        schemaVersion: 1,
        runKey: claim.runKey,
        taskId: claim.task.id,
        installationId: claim.task.installationId,
        userId: claim.task.userId,
        scheduledFor: claim.scheduledFor,
        status: "succeeded",
        attempt,
        startedAt,
        finishedAt: new Date(now()).toISOString(),
        threadId,
        error: null,
      };
      await options.store.appendRun(run);
      await options.store.settle(claim, { status: "succeeded" });
      results.push({ taskId: claim.task.id, runKey: claim.runKey, status: "succeeded", error: null });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 2_000) : "Error de ejecución";
      await options.store.appendRun({
        schemaVersion: 1,
        runKey: claim.runKey,
        taskId: claim.task.id,
        installationId: claim.task.installationId,
        userId: claim.task.userId,
        scheduledFor: claim.scheduledFor,
        status: "failed",
        attempt,
        startedAt,
        finishedAt: new Date(now()).toISOString(),
        threadId,
        error: detail,
      });
      await options.store.settle(claim, { status: "failed", error: detail });
      results.push({ taskId: claim.task.id, runKey: claim.runKey, status: "failed", error: detail });
    } finally {
      clearInterval(renewTimer);
    }
  }
  return results;
}
