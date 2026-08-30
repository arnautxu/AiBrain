import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { loadInstallationConfig } from "../src/config/installation";
import type { InstallationConfig } from "../src/config/installation-schema";
import { FileLocalUserStore } from "../src/auth/local-user-store";
import type { AuthSession } from "../src/auth/types";
import { FileAutomationStore } from "../src/automations/store";
import { runAutomationSweep } from "../src/automations/runner";
import { executeScheduledTurn } from "../src/automations/executor";
import { writeAutomationWorkerStatus } from "../src/automations/worker-status";
import { drainAutomaticMemoryJobs } from "../src/memory/automatic-extraction";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

function positiveInteger(name: string, fallback: number) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} requiere un entero positivo.`);
  return Number(value);
}

async function enabledUsers(usersRoot: string) {
  const store = new FileLocalUserStore(usersRoot);
  const entries = await readdir(usersRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const users = await Promise.all(entries.filter((entry) => entry.isDirectory() && USER_ID.test(entry.name)).map((entry) => store.read(entry.name)));
  return users.filter((user) => user?.enabled === true);
}

async function sweep(workerId: string, installation: Readonly<InstallationConfig>, concurrency: number, timeoutMs: number) {
  const users = await enabledUsers(installation.paths.usersRoot);
  const memory = await drainAutomaticMemoryJobs(installation, {
    userIds: users.flatMap((user) => user ? [user.userId] : []),
  });
  const outputs = await Promise.all(users.map(async (user) => {
    if (!user) return [];
    const session: AuthSession = {
      provider: "local",
      user: { id: user.userId, name: user.displayName, email: user.email },
      tenant: { id: installation.installationId, name: installation.companyName },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const store = new FileAutomationStore({
      installationId: installation.installationId,
      userId: user.userId,
      usersRoot: installation.paths.usersRoot,
    });
    return runAutomationSweep({
      store,
      ownerId: workerId,
      concurrency,
      timeoutMs,
      execute: (claim, existingThreadId, onThreadPrepared, signal) => executeScheduledTurn({
        installation,
        session,
        task: claim.task,
        runKey: claim.runKey,
        existingThreadId,
        onThreadPrepared,
        signal,
      }),
    });
  }));
  return { installation, output: outputs.flat(), memory };
}

async function main() {
  const once = process.argv.includes("--once");
  const allowed = new Set(["--once", "--interval-ms", "--concurrency", "--timeout-ms"]);
  const valued = new Set(["--interval-ms", "--concurrency", "--timeout-ms"]);
  for (let index = 2; index < process.argv.length; index += 1) {
    const current = process.argv[index];
    if (!allowed.has(current)) throw new Error(`Argumento desconocido: ${current}`);
    if (valued.has(current)) {
      if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) {
        throw new Error(`${current} requiere un valor.`);
      }
      index += 1;
    }
  }
  const intervalMs = positiveInteger("--interval-ms", 30_000);
  const concurrency = positiveInteger("--concurrency", 2);
  const timeoutMs = positiveInteger("--timeout-ms", 15 * 60_000);
  const workerId = `automation-${randomUUID()}`;
  const installation = await loadInstallationConfig();
  const heartbeat = () => writeAutomationWorkerStatus(installation.paths.dataRoot, {
    workerId,
    processId: process.pid,
    heartbeatAt: new Date().toISOString(),
    intervalMs,
  });
  await heartbeat();
  const heartbeatTimer = setInterval(() => void heartbeat().catch(() => undefined), Math.min(intervalMs, 10_000));
  heartbeatTimer.unref?.();
  do {
    const { output, memory } = await sweep(workerId, installation, concurrency, timeoutMs);
    await heartbeat();
    process.stdout.write(`${JSON.stringify({
      operation: "automations",
      workerId,
      processed: output.length,
      results: output,
      memoryJobs: {
        processed: memory.length,
        completed: memory.filter(({ status }) => status === "completed").length,
        pending: memory.filter(({ status }) => status === "pending").length,
      },
    })}\n`);
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
  clearInterval(heartbeatTimer);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "El worker de automatizaciones ha fallado."}\n`);
  process.exitCode = 1;
});
