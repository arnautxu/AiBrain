import { describe, expect, it } from "vitest";
import { BrowserInputQueue } from "./browser-input-queue";

describe("browser input lane", () => {
  it("bounds pending input without dispatching overflow", async () => {
    const queue = new BrowserInputQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const accepted = Array.from({ length: 128 }, () => queue.enqueue(() => gate));
    await expect(queue.enqueue(async () => { throw new Error("must not run"); })).rejects.toThrow("no está disponible");
    release();
    await Promise.all(accepted);
  });

  it("cancels dependent inputs after failure but accepts a new deliberate action", async () => {
    const queue = new BrowserInputQueue();
    const first = queue.enqueue(async () => { throw new Error("uncertain"); });
    const second = queue.enqueue(async () => "must not run");
    await expect(first).rejects.toThrow("uncertain");
    await expect(second).rejects.toThrow("cancelada");
    await expect(queue.enqueue(async () => "fresh")).resolves.toBe("fresh");
  });

  it("fences in-flight continuations and queued work on close", async () => {
    const queue = new BrowserInputQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.enqueue(async (assertCurrent) => { await gate; assertCurrent(); });
    await Promise.resolve();
    queue.cancel();
    release();
    await expect(first).rejects.toThrow("cancelada");
    await expect(queue.enqueue(async () => undefined)).rejects.toThrow("no está disponible");
  });
});
