import { mkdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ResourceLockManager,
  ResourceLockTimeoutError,
} from "@/storage";

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

describe("resource lock manager", () => {
  let root: string;
  let lockRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aibrain-lock-"));
    lockRoot = path.join(root, "locks");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function manager(overrides: Partial<ConstructorParameters<typeof ResourceLockManager>[0]> = {}) {
    return new ResourceLockManager({
      rootDirectory: lockRoot,
      staleAfterMs: 2_000,
      defaultTimeoutMs: 5_000,
      retryDelayMs: 1,
      maxRetryDelayMs: 5,
      heartbeatIntervalMs: 100,
      jitterRatio: 0,
      ...overrides,
    });
  }

  it("serializes concurrent operations across independent manager instances", async () => {
    const first = manager();
    const second = manager();
    let counter = 0;
    let inside = 0;
    let maximumInside = 0;

    await Promise.all(Array.from({ length: 50 }, (_, index) => {
      const selected = index % 2 === 0 ? first : second;
      return selected.withLock("user-1/thread-1", async () => {
        inside += 1;
        maximumInside = Math.max(maximumInside, inside);
        const previous = counter;
        await delay(index % 3);
        counter = previous + 1;
        inside -= 1;
      });
    }));

    expect(counter).toBe(50);
    expect(maximumInside).toBe(1);
  });

  it("times out without disturbing the current owner", async () => {
    const first = manager();
    const second = manager();
    const lease = await first.acquire("busy-resource");

    await expect(second.acquire("busy-resource", { timeoutMs: 25 }))
      .rejects.toBeInstanceOf(ResourceLockTimeoutError);
    await lease.assertHeld();
    await lease.release();

    const successor = await second.acquire("busy-resource", { timeoutMs: 100 });
    await successor.release();
  });

  it("recovers an abandoned stale lock directory", async () => {
    const locks = manager({ staleAfterMs: 100, heartbeatIntervalMs: 20 });
    const stalePath = locks.lockPathFor("abandoned");
    await mkdir(stalePath, { recursive: true });
    const staleTime = new Date(Date.now() - 5_000);
    await utimes(stalePath, staleTime, staleTime);

    const lease = await locks.acquire("abandoned", { timeoutMs: 100 });
    await lease.assertHeld();
    await lease.release();
  });

  it("heartbeats a live lease so it cannot be stolen as stale", async () => {
    const first = manager({ staleAfterMs: 60, heartbeatIntervalMs: 10 });
    const second = manager({ staleAfterMs: 60, heartbeatIntervalMs: 10 });
    const lease = await first.acquire("long-operation");

    await delay(100);
    await expect(second.acquire("long-operation", { timeoutMs: 30 }))
      .rejects.toBeInstanceOf(ResourceLockTimeoutError);
    await lease.assertHeld();
    await lease.release();
  });

  it("supports cancellation while waiting and idempotent release", async () => {
    const first = manager();
    const second = manager();
    const lease = await first.acquire("cancelled-waiter");
    const controller = new AbortController();
    const waiting = second.acquire("cancelled-waiter", {
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ code: "STORAGE_LOCK_ABORTED" });
    await lease.release();
    await lease.release();
  });

  it("hashes resource keys so paths cannot escape the lock root", () => {
    const locks = manager();
    const lockPath = locks.lockPathFor("../../another-user/secret");
    expect(path.dirname(lockPath)).toBe(lockRoot);
    expect(path.basename(lockPath)).toMatch(/^[0-9a-f]{64}\.lock$/);
  });
});
