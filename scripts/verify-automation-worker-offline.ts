import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUTOMATION_EXECUTION_CONTEXT } from "../src/automations/contracts";
import { runAutomationSweep } from "../src/automations/runner";
import { FileAutomationStore } from "../src/automations/store";

const INSTALLATION_ID = "automation-offline-acceptance";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const RESULT_THREAD_ID = "20000000-0000-4000-8000-000000000001";
const MIN_DELAY_MS = 120_000;
const MAX_DELAY_MS = 180_000;
const scriptPath = fileURLToPath(import.meta.url);

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string) {
  const value = argument(name);
  if (!value) throw new Error(`Falta ${name}.`);
  return value;
}

function store(usersRoot: string) {
  return new FileAutomationStore({ installationId: INSTALLATION_ID, userId: USER_ID, usersRoot });
}

async function worker() {
  const usersRoot = path.resolve(requiredArgument("--users-root"));
  const receiptPath = path.resolve(requiredArgument("--receipt"));
  const deadline = Number(requiredArgument("--deadline"));
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) throw new Error("El deadline del worker no es válido.");
  const automationStore = store(usersRoot);
  while (Date.now() <= deadline) {
    const output = await runAutomationSweep({
      store: automationStore,
      ownerId: `offline-acceptance-${process.pid}`,
      maxAttempts: 1,
      execute: async (claim, existingThreadId, onThreadPrepared) => {
        await mkdir(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
        const descriptor = await open(receiptPath, "wx", 0o600);
        try {
          await descriptor.writeFile(`${JSON.stringify({
            schemaVersion: 1,
            runKey: claim.runKey,
            prompt: claim.task.prompt,
            executedAt: new Date().toISOString(),
            processId: process.pid,
          })}\n`, "utf8");
          await descriptor.sync();
        } finally {
          await descriptor.close();
        }
        const threadId = existingThreadId ?? RESULT_THREAD_ID;
        await onThreadPrepared(threadId);
        return { threadId };
      },
    });
    if (output.some((item) => item.status === "succeeded")) {
      process.stdout.write(`${JSON.stringify({ worker: "completed", output })}\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("La automatización no se ejecutó dentro de la ventana controlada.");
}

async function orchestrate() {
  const delayMs = Number(argument("--delay-ms") ?? MIN_DELAY_MS);
  if (!Number.isSafeInteger(delayMs) || delayMs < MIN_DELAY_MS || delayMs > MAX_DELAY_MS) {
    throw new Error(`--delay-ms debe estar entre ${MIN_DELAY_MS} y ${MAX_DELAY_MS}.`);
  }
  const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "aibrain-automation-offline-"));
  const usersRoot = path.join(acceptanceRoot, "users");
  const receiptPath = path.join(acceptanceRoot, "controlling-store", "hello.json");
  const automationStore = store(usersRoot);
  const scheduledFor = new Date(Date.now() + delayMs).toISOString();
  const startedAt = Date.now();
  try {
    const task = await automationStore.create({
      name: "Hello offline acceptance",
      prompt: "hello",
      projectId: PROJECT_ID,
      projectName: "Sin proyecto",
      timeZone: "Europe/Madrid",
      schedule: { kind: "once", runAt: scheduledFor },
      executionContext: DEFAULT_AUTOMATION_EXECUTION_CONTEXT,
      audience: { membershipPolicy: "current", userIds: [USER_ID], groupIds: [] },
    });
    process.stdout.write(`${JSON.stringify({ client: "disconnected", taskId: task.id, scheduledFor })}\n`);

    const child = spawn(path.join(process.cwd(), "node_modules", ".bin", "tsx"), [
      scriptPath,
      "--worker",
      "--users-root", usersRoot,
      "--receipt", receiptPath,
      "--deadline", String(new Date(scheduledFor).getTime() + 30_000),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    if (exitCode !== 0) throw new Error(stderr.trim() || `El worker terminó con código ${exitCode}.`);

    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { runKey: string; prompt: string; executedAt: string };
    const runs = await automationStore.listRuns(task.id);
    const replay = await runAutomationSweep({
      store: automationStore,
      ownerId: `offline-replay-${randomUUID()}`,
      maxAttempts: 1,
      execute: async () => { throw new Error("Una ejecución terminal nunca debe repetirse."); },
    });
    const terminal = runs.filter((run) => run.status === "succeeded");
    const executionDelayMs = new Date(receipt.executedAt).getTime() - new Date(scheduledFor).getTime();
    if (receipt.prompt !== "hello" || terminal.length !== 1 || replay.length !== 0 ||
        receipt.runKey !== terminal[0]?.runKey || executionDelayMs < 0 || executionDelayMs > 10_000) {
      throw new Error("La evidencia exactly-once o de temporización no coincide con la tarea.");
    }
    process.stdout.write(stdout);
    process.stdout.write(`${JSON.stringify({
      accepted: true,
      clientSessionPresent: false,
      scheduledDelayMs: delayMs,
      executionDelayMs,
      runKey: receipt.runKey,
      terminalExecutions: terminal.length,
      replayExecutions: replay.length,
      historyStatuses: runs.map((run) => run.status),
      elapsedMs: Date.now() - startedAt,
    })}\n`);
  } finally {
    await rm(acceptanceRoot, { recursive: true, force: true });
  }
}

void (process.argv.includes("--worker") ? worker() : orchestrate()).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "La aceptación offline ha fallado."}\n`);
  process.exitCode = 1;
});
