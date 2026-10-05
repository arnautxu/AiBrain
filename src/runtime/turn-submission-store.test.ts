import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DurableTurnSubmission, TurnSubmissionRecoveryRequired, turnSubmissionBinding } from "./turn-submission-store";
import * as storage from "@/storage";
import { atomicWriteFile } from "@/storage/atomic-file";

const roots: string[] = [];
const leases: DurableTurnSubmission[] = [];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rpc = { threadId: "remote-thread", clientUserMessageId: id(5), input: [{ type: "text", text: "Fictional invoice", text_elements: [] }] };
const requestId = `turn-start:${id(4)}`;

async function fixture() {
  const userRoot = await mkdtemp(path.join(tmpdir(), "aibrain-submission-test-"));
  roots.push(userRoot);
  const workspace = path.join(userRoot, "workspace");
  await mkdir(workspace, { mode: 0o700 });
  const options = { userRoot, workspace, installationId: "test-company", userId: id(1),
    projectId: id(2), threadId: id(3), assistantMessageId: id(4),
    binding: turnSubmissionBinding(["test-company", id(1), id(2), id(3), id(4), id(5), "permission-fingerprint", "source-hash"]) };
  const open = async (overrides: Partial<typeof options> = {}) => {
    const value = await DurableTurnSubmission.open({ ...options, ...overrides });
    leases.push(value);
    return value;
  };
  const prepare = vi.fn(async (created: (directory: string) => Promise<void>) => {
    const directory = await mkdtemp(path.join(workspace, ".aibrain-turn-inputs-"));
    await created(directory);
    await writeFile(path.join(directory, "input-1.xlsx"), "original synthetic bytes", { mode: 0o600 });
    return { directory, codexInputs: [{ type: "text" as const,
      text: JSON.stringify([{ relativePath: `${path.basename(directory)}/input-1.xlsx` }]), text_elements: [] }] };
  });
  return { userRoot, options, open, prepare };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(leases.splice(0).map(lease => lease.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("durable turn submission", () => {
  it("retains the two-retry budget and exact attempt identity across restarts", async () => {
    const f = await fixture();
    let receipt = await f.open();
    let clientId = rpc.clientUserMessageId;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      await receipt.bindThread("remote-thread");
      await receipt.prepareInputs(f.prepare);
      await receipt.dispatchOnce({ ...rpc, clientUserMessageId: clientId }, `${requestId}:${attempt}`);
      const turnId = `rejected-turn-${attempt}`;
      await receipt.bindTurn(turnId);
      await receipt.observeTerminal(turnId, "failed");
      const rejected = { id: turnId, status: "failed", error: { codexErrorInfo: "serverOverloaded" },
        items: [{ type: "userMessage", clientId }] };
      if (attempt === 2) {
        await expect(receipt.retryRejectedCapacityTurn(rejected, clientId)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
        expect(receipt.terminal).toBe("failed");
        break;
      }
      await expect(receipt.retryRejectedCapacityTurn({ ...rejected, items: [...rejected.items, { type: "commandExecution" }] }, clientId))
        .rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
      await expect(receipt.retryRejectedCapacityTurn({ ...rejected, items: [{ type: "userMessage", clientId: id(99) }] }, id(99)))
        .rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
      await receipt.retryRejectedCapacityTurn(rejected, clientId);
      expect(receipt.capacityRetries).toBe(attempt + 1);
      expect(receipt.needsRecovery).toBe(false);
      expect(receipt.rejectedRuntimeTurnId).toBe(turnId);
      const nextClientId = receipt.retryClientUserMessageId!;
      expect(nextClientId).not.toBe(clientId);
      await receipt.close();
      receipt = await f.open();
      expect(receipt.retryClientUserMessageId).toBe(nextClientId);
      expect(receipt.capacityRetries).toBe(attempt + 1);
      clientId = nextClientId;
    }
  });

  it("upgrades a legacy receipt while preserving its dispatched fence", async () => {
    const f = await fixture();
    const receipt = await f.open();
    await receipt.bindThread("remote-thread");
    await receipt.prepareInputs(f.prepare);
    await receipt.dispatchOnce(rpc, requestId);
    const legacy = JSON.parse(await readFile(receipt.filePath, "utf8"));
    legacy.schemaVersion = 1;
    for (const key of ["capacityRetries", "retryClientUserMessageId", "rejectedRuntimeTurnId", "dispatchedClientUserMessageId"]) delete legacy[key];
    await receipt.close();
    await writeFile(receipt.filePath, JSON.stringify(legacy), { mode: 0o600 });
    const restarted = await f.open();
    expect(restarted.needsRecovery).toBe(true);
    expect(restarted.capacityRetries).toBe(0);
    await expect(restarted.dispatchOnce(rpc, requestId)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
  });
  it("fences a failed write acknowledgement after the intent reached disk", async () => {
    const f = await fixture();
    const first = await f.open();
    await first.bindThread("remote-thread");
    await first.prepareInputs(f.prepare);
    vi.spyOn(storage, "atomicWriteFile").mockImplementationOnce(async (...args) => {
      await atomicWriteFile(...args);
      throw Object.assign(new Error("simulated directory fsync failure"), { code: "EIO" });
    });
    await expect(first.dispatchOnce(rpc, requestId)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    expect(first.needsRecovery).toBe(true);
    await expect(first.dispatchOnce(rpc, requestId)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    await first.close();
    const restarted = await f.open();
    expect(restarted.needsRecovery).toBe(true);
    await expect(restarted.dispatchOnce(rpc, requestId)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
  });

  it("resumes prepared inputs after restart, without preparing or converting them again", async () => {
    const f = await fixture();
    const first = await f.open();
    const inputs = await first.prepareInputs(f.prepare);
    await first.bindThread("remote-thread");
    await first.close();
    const restarted = await f.open();
    expect(await restarted.prepareInputs(f.prepare)).toEqual(inputs);
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(restarted.needsRecovery).toBe(false);
    await restarted.dispatchOnce(rpc, requestId);
    const record = JSON.parse(await readFile(restarted.filePath, "utf8"));
    expect(record.turnRequest).toBe(JSON.stringify({ method: "turn/start", id: requestId, params: rpc }));
  });

  it("never dispatches again after a write-ahead intent, even before acceptance or after receipt eviction", async () => {
    const f = await fixture();
    const first = await f.open();
    const inputs = await first.prepareInputs(f.prepare);
    await first.bindThread("remote-thread");
    await first.dispatchOnce(rpc, requestId);
    await writeFile(path.join(inputs.directory!, "input-1.xlsx"), "in-progress edit", { mode: 0o600 });
    await first.close();
    const restarted = await f.open();
    expect(restarted.needsRecovery).toBe(true);
    await expect(restarted.dispatchOnce(rpc, requestId)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    await expect(restarted.prepareInputs(f.prepare)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    await restarted.validateWorkingCopies();
    expect(await readFile(path.join(inputs.directory!, "input-1.xlsx"), "utf8")).toBe("in-progress edit");
    await restarted.bindTurn("remote-turn");
    await restarted.observeTerminal("remote-turn", "completed");
    await restarted.close();
    await expect(access(inputs.directory!)).rejects.toMatchObject({ code: "ENOENT" });
    const tombstone = await f.open();
    expect(tombstone.terminal).toBe("completed");
    await expect(tombstone.dispatchOnce(rpc, requestId)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    const record = JSON.parse(await readFile(tombstone.filePath, "utf8"));
    expect(record).toMatchObject({ turnRequest: null, threadRequest: null, inputs: null, inputDirectory: null });
    expect(f.prepare).toHaveBeenCalledOnce();
  });

  it("rebuilds only unpublished partial preparation after a crash", async () => {
    const f = await fixture();
    const first = await f.open();
    let partial = "";
    await expect(first.prepareInputs(async created => {
      partial = await mkdtemp(path.join(f.options.workspace, ".aibrain-turn-inputs-"));
      await created(partial);
      throw new Error("preparation crash");
    })).rejects.toThrow("preparation crash");
    await first.close();
    const restarted = await f.open();
    const inputs = await restarted.prepareInputs(f.prepare);
    expect(inputs.directory).not.toBe(partial);
    await expect(access(partial)).rejects.toMatchObject({ code: "ENOENT" });
    expect(restarted.needsRecovery).toBe(false);
  });

  it("blocks a second runner while the first lease is alive", async () => {
    const f = await fixture();
    await f.open();
    await expect(f.open()).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
  });

  it("serializes acceptance and terminal projection without resurrecting cleared payloads", async () => {
    const f = await fixture();
    const submission = await f.open();
    await submission.prepareInputs(f.prepare);
    await submission.bindThread("remote-thread");
    await submission.dispatchOnce(rpc, requestId);
    await Promise.all([submission.bindTurn("remote-turn"), submission.observeTerminal("remote-turn", "completed")]);
    await submission.bindTurn("remote-turn");
    expect(JSON.parse(await readFile(submission.filePath, "utf8"))).toMatchObject({ phase: "terminal", turnRequest: null, inputs: null });
  });

  it("retains uncertainty when thread creation acknowledgement is lost", async () => {
    const f = await fixture();
    const first = await f.open();
    await first.startThreadOnce({ cwd: f.options.workspace }, `thread-start:${id(4)}`);
    await first.close();
    const restarted = await f.open();
    expect(restarted.needsRecovery).toBe(true);
    expect(restarted.pendingThreadRequest).toEqual({ method: "thread/start", id: `thread-start:${id(4)}`,
      params: { cwd: f.options.workspace } });
    await expect(restarted.startThreadOnce({}, `thread-start:${id(4)}`)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    await restarted.bindThread("recovered-original-thread");
    expect(restarted.needsRecovery).toBe(false);
    expect(restarted.pendingThreadRequest).toBeNull();
  });

  it("treats legacy existing admissions as recovery-only even without a new-format receipt", async () => {
    const f = await fixture();
    const submission = await DurableTurnSubmission.open({ ...f.options, recoveryOnly: true });
    leases.push(submission);
    expect(submission.needsRecovery).toBe(true);
    await expect(submission.prepareInputs(f.prepare)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it("does not let an early reconnect fence out a not-yet-started first runner", async () => {
    const f = await fixture();
    const observer = await DurableTurnSubmission.open({ ...f.options, recoveryOnly: true });
    leases.push(observer);
    await observer.bindThread("remote-thread");
    await expect(observer.dispatchOnce(rpc, requestId)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    await observer.close();
    const original = await f.open();
    await original.bindThread("remote-thread");
    await original.prepareInputs(f.prepare);
    await original.dispatchOnce(rpc, requestId);
    expect(original.needsRecovery).toBe(true);
  });

  it.each(["scope", "permissions", "sources"])("rejects a changed %s binding", async (changed) => {
    const f = await fixture();
    const first = await f.open();
    await first.close();
    await expect(f.open({ binding: turnSubmissionBinding([f.options.binding, changed]) })).rejects.toThrow("authorized request");
  });

  it.each(["missing", "symlink", "directory"])("preserves uncertainty for a %s working copy without regenerating it", async (kind) => {
    const f = await fixture();
    const submission = await f.open();
    const inputs = await submission.prepareInputs(f.prepare);
    const file = path.join(inputs.directory!, "input-1.xlsx");
    await submission.bindThread("remote-thread");
    await submission.dispatchOnce(rpc, requestId);
    await rm(file);
    const foreign = path.join(f.userRoot, "foreign-data");
    await writeFile(foreign, "preserve", { mode: 0o600 });
    if (kind === "symlink") await symlink(foreign, file);
    if (kind === "directory") await mkdir(file);
    await expect(submission.validateWorkingCopies()).rejects.toThrow();
    await expect(submission.prepareInputs(f.prepare)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    expect(await readFile(foreign, "utf8")).toBe("preserve");
    expect(f.prepare).toHaveBeenCalledOnce();
  });

  it("rejects a receipt symlink before reading foreign state", async () => {
    const f = await fixture();
    const first = await f.open();
    const file = first.filePath;
    await first.close();
    await rm(file);
    const foreign = path.join(f.userRoot, "unrelated.json");
    await writeFile(foreign, "unrelated", { mode: 0o600 });
    await symlink(foreign, file);
    await expect(f.open()).rejects.toThrow("Unsafe durable turn file");
    expect(await readFile(foreign, "utf8")).toBe("unrelated");
  });

  it("reloads an uncertain receipt after a real process crash and expired lease", async () => {
    const f = await fixture();
    const source = `const {DurableTurnSubmission}=require('./src/runtime/turn-submission-store.ts');
      (async()=>{ const s=await DurableTurnSubmission.open(JSON.parse(process.argv[1]));
      await s.bindThread('remote-thread'); await s.prepareInputs(async()=>({directory:null,codexInputs:[]}));
      await s.dispatchOnce(${JSON.stringify(rpc)},${JSON.stringify(requestId)});
      process.stdout.write('READY\\n'); setInterval(()=>{},1000); })().catch(e=>{console.error(e);process.exit(1)});`;
    const child = spawn(process.execPath, ["--import", "tsx", "-e", source, JSON.stringify(f.options)],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", data => { stderr += data.toString(); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Child timeout: ${stderr}`)), 10_000);
        child.stdout.once("data", data => { clearTimeout(timeout); data.toString().includes("READY") ? resolve() : reject(new Error("Invalid child readiness")); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Child exited: ${stderr}`)); });
      });
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      await expect(f.open()).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
      // Advance only the synthetic lease's mtime instead of sleeping 30 s.
      // Recovery still checks that its real owner PID is no longer alive.
      const lockRoot = path.join(f.userRoot, "state", ".locks");
      for (const name of await readdir(lockRoot)) await utimes(path.join(lockRoot, name), new Date(0), new Date(0));
      const restarted = await f.open();
      expect(restarted.needsRecovery).toBe(true);
      await expect(restarted.dispatchOnce(rpc, requestId)).rejects.toBeInstanceOf(TurnSubmissionRecoveryRequired);
    } finally { child.kill("SIGKILL"); }
  }, 15_000);
});
