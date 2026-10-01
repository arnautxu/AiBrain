import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type { UserInput } from "../../contracts/codex/0.153.4/types/v2/UserInput";
import { atomicWriteFile, ResourceLockManager } from "@/storage";
import type { ResourceLockLease } from "@/storage/resource-lock";
import { readRegularFileWithin } from "@/security/safe-file";
import { resolveWorkerOwnedPath } from "@/runtime/workers/provisioner";
import { validateAppServerRequest } from "@/runtime/transport/wire-protocol";
import { MAX_FILES_PER_MESSAGE } from "@/lib/chat-attachment-limits";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
type Inputs = { directory: string | null; codexInputs: readonly UserInput[] };
type Phase = "preparing" | "ready" | "dispatched" | "terminal";
type Terminal = "completed" | "failed" | "interrupted";

type RecordData = {
  schemaVersion: 1;
  binding: string;
  workspace: string;
  phase: Phase;
  inputs: Inputs | null;
  inputDirectory: string | null;
  threadRequest: string | null;
  turnRequest: string | null;
  runtimeThreadId: string | null;
  runtimeTurnId: string | null;
  terminal: Terminal | null;
};

export class TurnSubmissionRecoveryRequired extends Error {
  constructor(message = "El torn pendent necessita reconciliar l’estat remot; no s’ha repetit cap petició.") {
    super(message);
    this.name = "TurnSubmissionRecoveryRequired";
  }
}

export function turnSubmissionBinding(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nodeError(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function parseRecord(bytes: Buffer): RecordData {
  const value = JSON.parse(bytes.toString("utf8")) as RecordData;
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== [
    "schemaVersion", "binding", "workspace", "phase", "inputs", "inputDirectory", "threadRequest",
    "turnRequest", "runtimeThreadId", "runtimeTurnId", "terminal",
  ].sort().join() || value.schemaVersion !== 1 || !HASH.test(value.binding) ||
      typeof value.workspace !== "string" || !path.isAbsolute(value.workspace) ||
      !["preparing", "ready", "dispatched", "terminal"].includes(value.phase) ||
      (value.terminal !== null && !["completed", "failed", "interrupted"].includes(value.terminal)) ||
      (value.phase === "terminal") !== (value.terminal !== null)) {
    throw new Error("Invalid durable turn submission.");
  }
  for (const field of [value.inputDirectory, value.runtimeThreadId, value.runtimeTurnId]) {
    if (field !== null && (typeof field !== "string" || field.length === 0 || field.length > 4096)) {
      throw new Error("Invalid durable turn reference.");
    }
  }
  for (const [kind, request] of [["thread/start", value.threadRequest], ["turn/start", value.turnRequest]] as const) {
    if (request === null) continue;
    if (typeof request !== "string") throw new Error("Invalid durable request.");
    const rpc = JSON.parse(request);
    if (rpc.method !== kind || typeof rpc.id !== "string") throw new Error("Invalid durable request method.");
    validateAppServerRequest({ kind: "rpc-request", clientRequestId: rpc.id, rpc });
  }
  if (value.inputs !== null && (!value.inputs || typeof value.inputs !== "object" ||
      Object.keys(value.inputs).sort().join() !== "codexInputs,directory" ||
      value.inputs.directory !== value.inputDirectory || !Array.isArray(value.inputs.codexInputs) ||
      value.inputs.codexInputs.length > 1 || value.inputs.codexInputs.some((item) =>
        !item || item.type !== "text" || typeof item.text !== "string" ||
        !Array.isArray(item.text_elements) || item.text_elements.length !== 0))) {
    throw new Error("Invalid durable workbook inputs.");
  }
  if (value.phase === "ready" && !value.inputs) throw new Error("Missing prepared inputs.");
  return value;
}

async function privateDirectory(directory: string) {
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (!nodeError(error, "EEXIST")) throw error; }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("Unsafe turn submission directory.");
  }
}

/** App-owned state is outside every worker mount. The lease covers the whole
 * runner, not just a write, so concurrent reconnects cannot own the same turn. */
export class DurableTurnSubmission {
  private writes: Promise<void> = Promise.resolve();
  private constructor(
    readonly filePath: string,
    private data: RecordData,
    private readonly lease: ResourceLockLease,
    private persisted: boolean,
  ) {}

  static async open(input: {
    userRoot: string; installationId: string; userId: string; projectId: string;
    threadId: string; assistantMessageId: string; workspace: string; binding: string;
    recoveryOnly?: boolean; signal?: AbortSignal;
  }) {
    if (![input.userId, input.projectId, input.threadId, input.assistantMessageId].every(id => UUID.test(id)) ||
        !/^[a-z][a-z0-9-]{1,62}$/.test(input.installationId) || !HASH.test(input.binding) ||
        !path.isAbsolute(input.userRoot) || !path.isAbsolute(input.workspace)) {
      throw new Error("Invalid durable turn identity.");
    }
    const state = await resolveWorkerOwnedPath(input.userRoot, "state");
    await privateDirectory(state);
    const root = path.join(state, "turn-submissions");
    await privateDirectory(root);
    const thread = path.join(root, input.threadId);
    await privateDirectory(thread);
    const lockRoot = path.join(state, ".locks");
    await privateDirectory(lockRoot);
    const locks = new ResourceLockManager({ rootDirectory: lockRoot });
    let lease: ResourceLockLease;
    try {
      lease = await locks.acquire(`turn-submission:${input.installationId}:${input.userId}:${input.threadId}:${input.assistantMessageId}`,
        { timeoutMs: 100, signal: input.signal });
    } catch (error) {
      if (nodeError(error, "STORAGE_LOCK_TIMEOUT")) throw new TurnSubmissionRecoveryRequired();
      throw error;
    }
    const filePath = path.join(thread, `${input.assistantMessageId}.json`);
    try {
      let data: RecordData;
      let persisted = true;
      try {
        const metadata = await lstat(filePath);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0) {
          throw new Error("Unsafe durable turn file.");
        }
        data = parseRecord(await readRegularFileWithin(thread, path.basename(filePath), MAX_RECORD_BYTES));
        if (data.binding !== input.binding || data.workspace !== input.workspace) {
          throw new Error("The durable turn does not match its authorized request.");
        }
      } catch (error) {
        if (!nodeError(error, "ENOENT")) throw error;
        data = { schemaVersion: 1, binding: input.binding, workspace: input.workspace,
          phase: input.recoveryOnly ? "dispatched" : "preparing", inputs: null, inputDirectory: null,
          threadRequest: null, turnRequest: null, runtimeThreadId: null, runtimeTurnId: null, terminal: null };
        // A reconnect can outrun the original runner before it creates its
        // receipt. Do not fence out that first runner merely because this
        // observer has no evidence yet. Legacy callers remain recovery-only;
        // persist their receipt only after finding their exact remote turn.
        persisted = !input.recoveryOnly;
        if (persisted) await atomicWriteFile(filePath, JSON.stringify(data), { mode: 0o600 });
      }
      return new DurableTurnSubmission(filePath, data, lease, persisted);
    } catch (error) { await lease.release(); throw error; }
  }

  get runtimeThreadId() { return this.data.runtimeThreadId; }
  get runtimeTurnId() { return this.data.runtimeTurnId; }
  get needsRecovery() {
    return this.data.phase === "dispatched" || this.data.phase === "terminal" ||
      (this.data.threadRequest !== null && this.data.runtimeThreadId === null);
  }
  get terminal() { return this.data.terminal; }

  private update(change: (data: RecordData) => RecordData, writeAhead = false) {
    const operation = this.writes.then(async () => {
      await this.lease.assertHeld();
      const next = change(this.data);
      const bytes = Buffer.from(JSON.stringify(next));
      if (bytes.length > MAX_RECORD_BYTES) throw new Error("Durable turn exceeds its bounded storage limit.");
      parseRecord(bytes);
      if (this.persisted || next.runtimeTurnId !== null) {
        try {
          await atomicWriteFile(this.filePath, bytes, { mode: 0o600 });
        } catch (error) {
          if (!writeAhead) throw error;
          // A rename may have succeeded before directory fsync failed. Fence
          // this runner too; only reopening durable state can resolve that gap.
          this.data = next;
          throw new TurnSubmissionRecoveryRequired();
        }
        this.persisted = true;
      }
      this.data = next;
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  private async assertInputDirectory(directory: string) {
    const name = path.basename(directory);
    if (!/^\.aibrain-turn-inputs-[A-Za-z0-9]+$/.test(name) || path.dirname(directory) !== this.data.workspace) {
      throw new Error("Workbook directory escaped its admitted workspace.");
    }
    const safe = await resolveWorkerOwnedPath(this.data.workspace, name);
    const metadata = await lstat(safe);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0 ||
        await realpath(safe) !== path.join(await realpath(this.data.workspace), name)) {
      throw new Error("Unsafe admitted workbook directory.");
    }
  }

  async prepareInputs(prepare: (onDirectoryCreated: (directory: string) => Promise<void>) => Promise<Inputs>) {
    if (this.needsRecovery) throw new TurnSubmissionRecoveryRequired();
    if (this.data.inputs) {
      await this.validateWorkingCopies();
      return this.data.inputs;
    }
    // A crash during preparation cannot have sent this turn. Only this
    // recorded, private, unpublished directory may be discarded and rebuilt.
    await this.removeInputDirectory();
    const inputs = await prepare(async (directory) => {
      await this.assertInputDirectory(directory);
      await this.update(data => ({ ...data, inputDirectory: directory }));
    });
    await this.update(data => ({ ...data, inputs, inputDirectory: inputs.directory, phase: "ready" }));
    return inputs;
  }

  async validateWorkingCopies() {
    if (!this.data.inputDirectory) return;
    await this.assertInputDirectory(this.data.inputDirectory);
    const text = this.data.inputs?.codexInputs[0];
    if (!text || text.type !== "text") throw new Error("Missing admitted workbook manifest.");
    const files: unknown = JSON.parse(text.text.split("\n").at(-1)!);
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES_PER_MESSAGE) throw new Error("Invalid workbook manifest.");
    for (const [index, file] of files.entries()) {
      const name = `input-${index + 1}.xlsx`;
      if (!file || file.relativePath !== path.posix.join(path.basename(this.data.inputDirectory), name)) {
        throw new Error("Invalid admitted workbook path.");
      }
      const metadata = await lstat(path.join(this.data.inputDirectory, name));
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
          (metadata.mode & 0o077) !== 0 || metadata.size > 50 * 1024 * 1024) {
        throw new Error("Unsafe admitted workbook copy.");
      }
      // Copies are editable: comparing them to the source hash here would
      // reject legitimate in-progress work. Originals stay in immutable staging.
    }
  }

  async bindThread(threadId: string) {
    if (this.data.runtimeThreadId && this.data.runtimeThreadId !== threadId) throw new Error("Durable thread identity changed.");
    await this.update(data => {
      if (data.runtimeThreadId && data.runtimeThreadId !== threadId) throw new Error("Durable thread identity changed.");
      return { ...data, runtimeThreadId: threadId };
    });
  }

  async startThreadOnce(params: unknown, requestId: string) {
    if (this.data.threadRequest || this.needsRecovery) throw new TurnSubmissionRecoveryRequired();
    await this.update(data => {
      if (data.threadRequest || data.phase === "dispatched" || data.phase === "terminal") throw new TurnSubmissionRecoveryRequired();
      return { ...data, threadRequest: JSON.stringify({ method: "thread/start", id: requestId, params }) };
    }, true);
  }

  async dispatchOnce(params: unknown, requestId: string) {
    if (this.data.phase !== "ready" || !this.data.runtimeThreadId) throw new TurnSubmissionRecoveryRequired();
    await this.validateWorkingCopies();
    // Write-ahead intent is an at-most-once fence, including after receipt
    // compaction at the gateway. Any failure after this write requires a read;
    // it never rolls the phase back or authorizes another model submission.
    await this.update(data => {
      if (data.phase !== "ready") throw new TurnSubmissionRecoveryRequired();
      return { ...data, phase: "dispatched",
        turnRequest: JSON.stringify({ method: "turn/start", id: requestId, params }) };
    }, true);
  }

  async bindTurn(turnId: string) {
    if (this.data.runtimeTurnId && this.data.runtimeTurnId !== turnId) throw new Error("Durable turn identity changed.");
    await this.update(data => {
      if (data.runtimeTurnId && data.runtimeTurnId !== turnId) throw new Error("Durable turn identity changed.");
      return { ...data, runtimeTurnId: turnId };
    });
  }

  async observeTerminal(turnId: string, status: Terminal) {
    if ((this.data.runtimeTurnId && this.data.runtimeTurnId !== turnId) ||
        (this.data.terminal && this.data.terminal !== status)) throw new Error("Terminal turn identity changed.");
    await this.update(data => {
      if ((data.runtimeTurnId && data.runtimeTurnId !== turnId) ||
          (data.terminal && data.terminal !== status)) throw new Error("Terminal turn identity changed.");
      return { ...data, phase: "terminal", terminal: status, runtimeTurnId: turnId,
        threadRequest: null, turnRequest: null, inputs: null };
    });
  }

  private async removeInputDirectory() {
    if (!this.data.inputDirectory) return;
    try {
      await this.assertInputDirectory(this.data.inputDirectory);
      await rm(this.data.inputDirectory, { recursive: true, force: false });
    } catch (error) { if (!nodeError(error, "ENOENT")) throw error; }
    await this.update(data => ({ ...data, inputDirectory: null }));
  }

  async close() {
    try {
      await this.writes;
      if (this.data.phase === "terminal") await this.removeInputDirectory();
    } finally { await this.lease.release(); }
  }
}
