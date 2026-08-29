import { hostname } from "node:os";
import type { AutomationRun } from "@/automations/contracts";
import type { FileAutomationStore, ClaimedAutomation } from "@/automations/store";

export type AutomationExecution = (
  claim: ClaimedAutomation,
  existingThreadId: string | null,
  onThreadPrepared: (threadId: string) => Promise<void>,
  signal: AbortSignal,
) => Promise<{ threadId: string | null }>;

export async function runAutomationSweep(options: {
  store: FileAutomationStore;
  execute: AutomationExecution;
  ownerId?: string;
  now?: () => number;
  limit?: number;
  concurrency?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  const ownerId = options.ownerId ?? `${hostname()}-${process.pid}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
  const claims = await options.store.claimDue(ownerId, options.limit ?? 10);
  const results: { taskId: string; runKey: string; status: "succeeded" | "failed"; error: string | null }[] = [];
  const maxAttempts = options.maxAttempts ?? 3;
  const retryBaseMs = options.retryBaseMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const executeClaim = async (claim: ClaimedAutomation) => {
    const previous = await options.store.latestRun(claim.runKey);
    if (previous?.status === "succeeded" || previous?.status === "failed") {
      // A failed entry is only terminal after its retry budget was exhausted.
      // A retryAt on the task tells claimDue to replay the same run key.
      if (previous.status === "failed" && claim.task.retryAt) {
        // Continue below with a fresh attempt.
      } else {
      await options.store.settle(claim, { status: previous.status, error: previous.error });
      results.push({ taskId: claim.task.id, runKey: claim.runKey, status: previous.status, error: previous.error });
      return;
      }
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
    const controller = new AbortController();
    let leaseLost = false;
    let renewal = Promise.resolve();
    const renew = () => {
      renewal = renewal.then(async () => {
        try {
          await options.store.renewLease(claim);
        } catch {
          leaseLost = true;
          controller.abort(new Error("La concesión de automatización se ha perdido."));
        }
      });
      return renewal;
    };
    const renewTimer = setInterval(() => { void renew(); }, 60_000);
    renewTimer.unref?.();
    const timeoutTimer = setTimeout(() => controller.abort(new Error("La automatización excedió el tiempo máximo de ejecución.")), timeoutMs);
    timeoutTimer.unref?.();
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
      }, controller.signal);
      await renew();
      if (leaseLost || controller.signal.aborted) throw controller.signal.reason ?? new Error("La automatización se ha cancelado.");
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
      if (leaseLost) {
        // A fenced successor owns the outcome. Do not advance or retry from a
        // stale worker; its deterministic turn ids keep the remote side safe.
        results.push({ taskId: claim.task.id, runKey: claim.runKey, status: "failed", error: detail });
      } else if (attempt < maxAttempts) {
        const delay = retryBaseMs * (2 ** (attempt - 1));
        await options.store.retry(claim, { error: detail, retryAt: new Date(now() + delay).toISOString() });
        results.push({ taskId: claim.task.id, runKey: claim.runKey, status: "failed", error: detail });
      } else {
        await options.store.settle(claim, { status: "failed", error: detail });
        results.push({ taskId: claim.task.id, runKey: claim.runKey, status: "failed", error: detail });
      }
    } finally {
      clearInterval(renewTimer);
      clearTimeout(timeoutTimer);
    }
  };
  // Worker concurrency is intentionally bounded. Claims/leases are durable,
  // while distinct employee App Server handles preserve user-local CODEX_HOME.
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, claims.length || 1));
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < claims.length) {
      const claim = claims[cursor++];
      await executeClaim(claim);
    }
  }));
  return results;
}
