import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { atomicWriteFile, ResourceLockManager } from "@/storage";
import { readRegularFileWithin } from "@/security/safe-file";

type Ticket = { key: string; owner: string; state: "waiting" | "running"; seenAt: number };
type QueueState = { schemaVersion: 1; tickets: Ticket[] };
export type ModelTurnAdmission = { complete(): Promise<void> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function integer(value: string | number | undefined, fallback: number, maximum: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error("Invalid model queue configuration.");
  return parsed;
}

/** Shared by app and automation processes. Waiting tickets expire; admitted
 * tickets never expire automatically because the provider may still be working.
 * Only the same durable turn can recover and finish an uncertain admission. */
export class FileModelTurnQueue {
  private readonly locks: ResourceLockManager;
  private readonly maxConcurrent: number;
  private readonly maxWaiting: number;
  private readonly waitMs: number;
  private readonly pollMs: number;
  private readonly staleWaitingMs: number;
  constructor(private readonly root: string, options: {
    maxConcurrent?: number; maxWaiting?: number; waitMs?: number; pollMs?: number; staleWaitingMs?: number;
  } = {}) {
    if (!path.isAbsolute(root) || root === path.parse(root).root) throw new Error("Invalid model queue root.");
    this.maxConcurrent = integer(options.maxConcurrent ?? process.env.AIBRAIN_MODEL_MAX_CONCURRENT, 2, 32);
    this.maxWaiting = integer(options.maxWaiting ?? process.env.AIBRAIN_MODEL_MAX_WAITING, 50, 200);
    this.waitMs = integer(options.waitMs ?? process.env.AIBRAIN_MODEL_QUEUE_WAIT_MS, 300_000, 3_600_000);
    this.pollMs = integer(options.pollMs, 1_000, 10_000);
    this.staleWaitingMs = integer(options.staleWaitingMs, 30_000, 300_000);
    this.locks = new ResourceLockManager({ rootDirectory: path.join(root, "locks") });
  }

  private async change<T>(operation: (state: QueueState) => T): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Unsafe model queue root.");
    const lease = await this.locks.acquire("model-turn-queue", { timeoutMs: 10_000 });
    try {
      let state: QueueState;
      try {
        const file = await lstat(path.join(this.root, "queue.json"));
        if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (file.mode & 0o077) !== 0) throw new Error("Unsafe model queue state.");
        state = JSON.parse((await readRegularFileWithin(this.root, "queue.json", 1_048_576)).toString("utf8"));
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        state = { schemaVersion: 1, tickets: [] };
      }
      if (!state || state.schemaVersion !== 1 || Object.keys(state).sort().join() !== "schemaVersion,tickets" ||
          !Array.isArray(state.tickets) || state.tickets.length > 4096 || state.tickets.some(ticket =>
            !ticket || Object.keys(ticket).sort().join() !== "key,owner,seenAt,state" ||
            !/^[a-f0-9]{64}$/.test(ticket.key) || !UUID.test(ticket.owner) ||
            !["waiting", "running"].includes(ticket.state) || !Number.isSafeInteger(ticket.seenAt) || ticket.seenAt < 0) ||
          new Set(state.tickets.map(ticket => ticket.key)).size !== state.tickets.length) throw new Error("Invalid model queue state.");
      const before = JSON.stringify(state);
      const result = operation(state);
      const after = JSON.stringify(state);
      if (before !== after) {
        await lease.assertHeld();
        await atomicWriteFile(path.join(this.root, "queue.json"), after, { mode: 0o600 });
      }
      return result;
    } finally { await lease.release(); }
  }

  async acquire(identity: { installationId: string; userId: string; threadId: string; turnId: string }, options: {
    signal: AbortSignal; recovering: boolean; onWaiting(position: number): Promise<void>;
  }): Promise<ModelTurnAdmission> {
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(identity.installationId) ||
        [identity.userId, identity.threadId, identity.turnId].some(id => !UUID.test(id))) throw new Error("Invalid queue identity.");
    const key = createHash("sha256").update(JSON.stringify([identity.installationId, identity.userId, identity.threadId, identity.turnId])).digest("hex");
    const owner = randomUUID();
    const started = Date.now();
    let position = -1;
    const complete = async () => {
      await this.change(state => { state.tickets = state.tickets.filter(ticket => ticket.key !== key || ticket.owner !== owner); });
    };
    try {
      for (;;) {
        if (options.signal.aborted) throw options.signal.reason ?? new Error("Queue wait cancelled.");
        if (Date.now() - started >= this.waitMs) throw new Error("La petición ha esperado demasiado en la cola. La conversación y los adjuntos se conservan; vuelve a intentarlo en unos minutos.");
        const observed = await this.change(state => {
          const now = Date.now();
          state.tickets = state.tickets.filter(ticket => ticket.state === "running" || ticket.key === key || now - ticket.seenAt < this.staleWaitingMs);
          let ticket = state.tickets.find(value => value.key === key);
          if (!ticket) {
            if (!options.recovering && state.tickets.filter(value => value.state === "waiting").length >= this.maxWaiting) {
              throw new Error("Hay demasiadas peticiones en espera. La conversación y los adjuntos se conservan; vuelve a intentarlo en unos minutos.");
            }
            ticket = { key, owner, state: options.recovering ? "running" : "waiting", seenAt: now };
            state.tickets.push(ticket);
          }
          ticket.owner = owner;
          if (now - ticket.seenAt >= Math.min(5_000, this.staleWaitingMs / 2)) ticket.seenAt = now;
          const waiting = state.tickets.filter(value => value.state === "waiting");
          if (ticket.state === "waiting" && waiting[0] === ticket &&
              state.tickets.filter(value => value.state === "running").length < this.maxConcurrent) ticket.state = "running";
          return ticket.state === "running" ? 0 : waiting.indexOf(ticket) + 1;
        });
        if (observed === 0) return { complete };
        if (position !== observed) { position = observed; await options.onWaiting(position); }
        await delay(this.pollMs, undefined, { signal: options.signal });
      }
    } catch (error) {
      // No model dispatch can occur until acquire has returned its receipt.
      await complete();
      throw error;
    }
  }
}
