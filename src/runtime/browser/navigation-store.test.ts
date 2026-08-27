import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrowserNavigationStore,
  BrowserNavigationStoreError,
} from "@/runtime/browser/navigation-store";

const USER = "0198b9f0-6631-7000-8000-000000000401";
const THREAD_A = "0198b9f0-6631-7000-8000-000000000411";
const THREAD_B = "0198b9f0-6631-7000-8000-000000000412";
const THREAD_C = "0198b9f0-6631-7000-8000-000000000413";
const roots: string[] = [];

async function fixture(options: { maxEntries?: number; now?: () => number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-browser-navigation-"));
  roots.push(root);
  const browserRoot = path.join(root, "browser");
  await mkdir(browserRoot, { mode: 0o700 });
  return {
    root,
    browserRoot,
    store: new BrowserNavigationStore({
      browserRoot,
      installationId: "chrome-lab",
      userId: USER,
      ...options,
    }),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("BrowserNavigationStore", () => {
  it("persists atomically, survives restart and evicts only the least recently used recovery entry", async () => {
    let now = Date.parse("2026-08-27T00:00:00.000Z");
    const files = await fixture({ maxEntries: 2, now: () => now++ });
    await files.store.set(THREAD_A, "https://a.example.test/");
    await files.store.set(THREAD_B, "https://b.example.test/");
    await files.store.set(THREAD_A, "https://a.example.test/current");
    await files.store.set(THREAD_C, "about:blank");

    const restarted = new BrowserNavigationStore({
      browserRoot: files.browserRoot,
      installationId: "chrome-lab",
      userId: USER,
      maxEntries: 2,
      now: () => now++,
    });
    await expect(restarted.get(THREAD_A)).resolves.toBe("https://a.example.test/current");
    await expect(restarted.get(THREAD_B)).resolves.toBeNull();
    await expect(restarted.get(THREAD_C)).resolves.toBe("about:blank");
    expect((await stat(files.store.stateFile)).mode & 0o077).toBe(0);
    expect(JSON.parse(await readFile(files.store.stateFile, "utf8"))).toMatchObject({
      schemaVersion: 1,
      installationId: "chrome-lab",
      userId: USER,
    });
  });

  it("fails closed for a hardlinked state file or another user binding", async () => {
    const files = await fixture();
    await files.store.set(THREAD_A, "https://safe.example.test/");
    const hardlink = path.join(files.root, "navigation-hardlink.json");
    await link(files.store.stateFile, hardlink);
    await expect(files.store.get(THREAD_A)).rejects.toMatchObject({
      code: "BROWSER_NAVIGATION_PATH_UNSAFE",
    });
    await rm(hardlink);

    const state = JSON.parse(await readFile(files.store.stateFile, "utf8")) as Record<string, unknown>;
    state.userId = "0198b9f0-6631-7000-8000-000000000499";
    await writeFile(files.store.stateFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await chmod(files.store.stateFile, 0o600);
    await expect(files.store.get(THREAD_A)).rejects.toBeInstanceOf(BrowserNavigationStoreError);
    await expect(files.store.get(THREAD_A)).rejects.toMatchObject({
      code: "BROWSER_NAVIGATION_BINDING_MISMATCH",
    });
  });
});
