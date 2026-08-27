import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { BrowserRuntimeContext } from "@/runtime/browser/types";
import { ChromeCdpRuntime } from "@/runtime/browser/chrome-runtime";

const executableCandidates = [
  process.env.AIBRAIN_CHROME_EXECUTABLE,
  process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined,
  process.platform === "darwin"
    ? "/Applications/Chromium.app/Contents/MacOS/Chromium"
    : undefined,
  process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
  process.platform === "linux" ? "/usr/bin/chromium" : undefined,
].filter((candidate): candidate is string => Boolean(candidate));
const executablePath = executableCandidates.find(existsSync);
const enabled = process.env.AIBRAIN_REAL_CHROME_TEST === "1";
const temporaryRoots: string[] = [];

async function runtimeContext(root: string, userId: string, browserSessionId: string) {
  const browserRoot = path.join(root, userId, "browser");
  const profile = path.join(browserRoot, "profile");
  const downloads = path.join(browserRoot, "downloads");
  await Promise.all([
    mkdir(profile, { recursive: true, mode: 0o700 }),
    mkdir(downloads, { recursive: true, mode: 0o700 }),
  ]);
  return {
    installationId: "real-chrome-lab",
    userId,
    browserSessionId,
    generation: 1,
    recovering: false,
    roots: {
      browserRoot,
      profile,
      downloads,
      stateFile: path.join(browserRoot, "session.json"),
    },
  } satisfies BrowserRuntimeContext;
}

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition did not become true");
}

afterAll(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.runIf(enabled)("real Chrome per-user isolation", () => {
  it("isolates ports, profiles, cookies, tabs and downloads and reopens one profile", async () => {
    if (!executablePath) {
      throw new Error("AIBRAIN_REAL_CHROME_TEST requires a Chrome/Chromium executable.");
    }
    const requests: Array<{ path: string; cookie: string }> = [];
    const server = createServer((request, response) => {
      const requestPath = request.url ?? "/";
      requests.push({ path: requestPath, cookie: request.headers.cookie ?? "" });
      if (requestPath === "/set-a" || requestPath === "/set-b") {
        const value = requestPath.endsWith("a") ? "A" : "B";
        response.setHeader("Set-Cookie", `profile=${value}; Path=/; SameSite=Lax; Max-Age=3600`);
        response.end(`cookie ${value}`);
        return;
      }
      if (requestPath === "/download-a" || requestPath === "/download-b") {
        const value = requestPath.endsWith("a") ? "A" : "B";
        response.setHeader("Content-Type", "text/plain");
        response.setHeader("Content-Disposition", `attachment; filename="${value}.txt"`);
        response.end(`download ${value}`);
        return;
      }
      response.setHeader("Content-Type", "text/html");
      response.end(`<html><body>${requestPath}</body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("unexpected HTTP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-real-chrome-"));
    temporaryRoots.push(root);
    const contextA = await runtimeContext(
      root,
      "0198b9f0-6631-7000-8000-000000000411",
      "0198b9f0-6631-7000-8000-000000000412",
    );
    const contextB = await runtimeContext(
      root,
      "0198b9f0-6631-7000-8000-000000000421",
      "0198b9f0-6631-7000-8000-000000000422",
    );
    const options = {
      executablePath,
      expectedVersion: process.env.AIBRAIN_CHROME_EXPECTED_VERSION,
      startupTimeoutMs: 60_000,
    };
    const runtimeA = new ChromeCdpRuntime(contextA, options);
    const runtimeB = new ChromeCdpRuntime(contextB, options);
    let reopened: ChromeCdpRuntime | null = null;
    try {
      await Promise.all([runtimeA.start(), runtimeB.start()]);
      expect(runtimeA.debuggingPort).not.toBe(runtimeB.debuggingPort);
      expect(runtimeA.targetId).not.toBe(runtimeB.targetId);
      expect(contextA.roots.profile).not.toBe(contextB.roots.profile);
      await Promise.all([runtimeA.takeOver(), runtimeB.takeOver()]);
      await Promise.all([
        runtimeA.navigate(`${origin}/set-a`),
        runtimeB.navigate(`${origin}/set-b`),
      ]);
      await Promise.all([
        runtimeA.navigate(`${origin}/echo-a`),
        runtimeB.navigate(`${origin}/echo-b`),
      ]);
      await eventually(() => requests.some((item) => item.path === "/echo-a") &&
        requests.some((item) => item.path === "/echo-b"));
      expect(requests.find((item) => item.path === "/echo-a")?.cookie).toContain("profile=A");
      expect(requests.find((item) => item.path === "/echo-a")?.cookie).not.toContain("profile=B");
      expect(requests.find((item) => item.path === "/echo-b")?.cookie).toContain("profile=B");
      expect(requests.find((item) => item.path === "/echo-b")?.cookie).not.toContain("profile=A");
      await eventually(async () => (await runtimeA.currentUrl()).includes("/echo-a") &&
        (await runtimeB.currentUrl()).includes("/echo-b"));
      await Promise.all([
        runtimeA.navigate(`${origin}/download-a`),
        runtimeB.navigate(`${origin}/download-b`),
      ]);
      await eventually(async () => (await readdir(contextA.roots.downloads)).includes("A.txt") &&
        (await readdir(contextB.roots.downloads)).includes("B.txt"));
      expect(await readdir(contextA.roots.downloads)).not.toContain("B.txt");
      expect(await readdir(contextB.roots.downloads)).not.toContain("A.txt");
      await Promise.all([runtimeA.stop(), runtimeB.stop()]);

      reopened = new ChromeCdpRuntime({
        ...contextA,
        browserSessionId: "0198b9f0-6631-7000-8000-000000000413",
        generation: 2,
        recovering: true,
      }, options);
      await reopened.start();
      await reopened.takeOver();
      await reopened.navigate(`${origin}/echo-a-reopened`);
      await eventually(() => requests.some((item) => item.path === "/echo-a-reopened"));
      expect(requests.find((item) => item.path === "/echo-a-reopened")?.cookie).toContain("profile=A");
      await reopened.stop();
    } finally {
      await Promise.allSettled([runtimeA.stop(), runtimeB.stop(), reopened?.stop()]);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);
});
