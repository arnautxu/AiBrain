import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { FileModelTurnQueue } from "./model-turn-queue";

const roots: string[] = [];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = (n: number) => ({ installationId: "test-company", userId: id(n), threadId: id(n + 100), turnId: id(n + 200) });
const options = () => ({ signal: new AbortController().signal, recovering: false, onWaiting: async () => {} });
async function fixture(maxConcurrent = 1) {
  const root = await mkdtemp(path.join(tmpdir(), "model-queue-"));
  roots.push(root);
  return { root, queue: () => new FileModelTurnQueue(root, { maxConcurrent, pollMs: 5, waitMs: 2_000 }) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("installation model queue", () => {
  it("retains a real child process's admitted work after a crash until exact recovery", async () => {
    const f = await fixture();
    const source = `const { FileModelTurnQueue } = require('./src/runtime/model-turn-queue.ts');
      (async () => { const args = JSON.parse(process.argv[1]);
        await new FileModelTurnQueue(args.root, { maxConcurrent: 1 }).acquire(args.identity,
          { signal: new AbortController().signal, recovering: false, onWaiting: async () => {} });
        console.log('ADMITTED'); setInterval(() => {}, 1000);
      })().catch(e => { console.error(e.message); process.exit(1); });`;
    const child = spawn(process.execPath, ["--import", "tsx", "-e", source, JSON.stringify({ root: f.root, identity: identity(1) })],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", data => { stderr += data.toString(); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Child timeout: ${stderr}`)), 10_000);
        child.stdout.once("data", data => { clearTimeout(timer); data.toString().includes("ADMITTED") ? resolve() : reject(new Error("Invalid child readiness")); });
        child.once("exit", () => { clearTimeout(timer); reject(new Error(`Child exited: ${stderr}`)); });
      });
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      await expect(new FileModelTurnQueue(f.root, { maxConcurrent: 1, waitMs: 30, pollMs: 5 })
        .acquire(identity(2), options())).rejects.toThrow("esperado demasiado");
      await (await f.queue().acquire(identity(1), { ...options(), recovering: true })).complete();
      await (await f.queue().acquire(identity(2), options())).complete();
    } finally { child.kill("SIGKILL"); }
  }, 15_000);

  it("shares slots between instances, admits in FIFO order and releases only the owner's ticket", async () => {
    const f = await fixture(2);
    const first = await f.queue().acquire(identity(1), options());
    const second = await f.queue().acquire(identity(2), options());
    let sawThird!: () => void;
    const thirdWaiting = new Promise<void>(resolve => { sawThird = resolve; });
    const third = f.queue().acquire(identity(3), { ...options(), onWaiting: async () => { sawThird(); } });
    await thirdWaiting;
    let sawFourth!: () => void;
    const fourthWaiting = new Promise<void>(resolve => { sawFourth = resolve; });
    const fourth = f.queue().acquire(identity(4), { ...options(), onWaiting: async () => { sawFourth(); } });
    await fourthWaiting;
    await first.complete();
    const thirdLease = await third;
    const state = JSON.parse(await readFile(path.join(f.root, "queue.json"), "utf8"));
    expect(state.tickets.map((ticket: { state: string }) => ticket.state)).toEqual(["running", "running", "waiting"]);
    await thirdLease.complete();
    await (await fourth).complete();
    await second.complete();
    expect(JSON.parse(await readFile(path.join(f.root, "queue.json"), "utf8")).tickets).toEqual([]);
  });

  it("cancels a waiting request without admitting it or deleting the active request", async () => {
    const f = await fixture();
    const active = await f.queue().acquire(identity(1), options());
    const abort = new AbortController();
    await expect(f.queue().acquire(identity(2), { ...options(), signal: abort.signal,
      onWaiting: async () => { abort.abort(); } })).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(f.root, "queue.json"), "utf8")).tickets).toHaveLength(1);
    await active.complete();
  });

  it("keeps uncertain running tickets across restart until the same turn reconciles", async () => {
    const f = await fixture();
    const original = await f.queue().acquire(identity(1), options());
    const file = path.join(f.root, "queue.json");
    const state = JSON.parse(await readFile(file, "utf8"));
    state.tickets[0].seenAt = 1;
    await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    const short = new FileModelTurnQueue(f.root, { maxConcurrent: 1, waitMs: 30, pollMs: 5 });
    await expect(short.acquire(identity(2), options())).rejects.toThrow("esperado demasiado");
    const recovered = await f.queue().acquire(identity(1), { ...options(), recovering: true });
    await original.complete();
    expect(JSON.parse(await readFile(file, "utf8")).tickets).toHaveLength(1);
    await recovered.complete();
    await (await f.queue().acquire(identity(2), options())).complete();
  });

  it("bounds waiting requests and allows recovery when all slots are occupied", async () => {
    const f = await fixture();
    const queue = new FileModelTurnQueue(f.root, { maxConcurrent: 1, maxWaiting: 1, pollMs: 5 });
    const first = await queue.acquire(identity(1), options());
    const abort = new AbortController();
    let ready!: () => void;
    const waiting = new Promise<void>(resolve => { ready = resolve; });
    const pending = queue.acquire(identity(2), { ...options(), signal: abort.signal, onWaiting: async () => { ready(); } });
    const rejected = expect(pending).rejects.toThrow();
    await waiting;
    await expect(queue.acquire(identity(3), options())).rejects.toThrow("demasiadas peticiones");
    const oldTurn = await queue.acquire(identity(4), { ...options(), recovering: true });
    abort.abort();
    await rejected;
    await oldTurn.complete();
    await first.complete();
  });
});
