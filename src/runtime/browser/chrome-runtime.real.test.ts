import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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
const THREAD_A = "0198b9f0-6631-7000-8000-000000000414";
const THREAD_A2 = "0198b9f0-6631-7000-8000-000000000415";
const THREAD_B = "0198b9f0-6631-7000-8000-000000000424";
const execFileAsync = promisify(execFile);

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

async function expectNoTcpListener(runtime: ChromeCdpRuntime) {
  const lsof = ["/usr/sbin/lsof", "/usr/bin/lsof"].find(existsSync);
  if (!lsof) return;
  const child = (runtime as unknown as { process: { pid?: number } | null }).process;
  expect(child?.pid).toBeTypeOf("number");
  try {
    const { stdout } = await execFileAsync(lsof, [
      "-nP",
      "-a",
      "-p", String(child?.pid),
      "-iTCP",
      "-sTCP:LISTEN",
    ]);
    expect(stdout.trim()).toBe("");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException & { code?: number }).code;
    if (code !== 1) throw error;
  }
}

afterAll(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.runIf(enabled)("real Chrome per-user isolation", () => {
  it("loads a public HTTPS page only through the pinned egress proxy", async () => {
    if (!executablePath) {
      throw new Error("AIBRAIN_REAL_CHROME_TEST requires a Chrome/Chromium executable.");
    }
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-real-chrome-egress-"));
    temporaryRoots.push(root);
    const context = await runtimeContext(
      root,
      "0198b9f0-6631-7000-8000-000000000431",
      "0198b9f0-6631-7000-8000-000000000432",
    );
    const runtime = new ChromeCdpRuntime(context, {
      executablePath,
      expectedVersion: process.env.AIBRAIN_CHROME_EXPECTED_VERSION,
      startupTimeoutMs: 60_000,
    });
    try {
      await runtime.start();
      await runtime.agentNavigate(THREAD_A, "https://example.com/");
      await eventually(async () => {
        const page = await runtime.readPage(THREAD_A);
        return page.title === "Example Domain" && page.text.includes("Example Domain");
      }, 30_000);
      await expect(runtime.health()).resolves.toMatchObject({
        healthy: true,
        detail: expect.stringContaining("pinned loopback egress"),
      });
      await expectNoTcpListener(runtime);
    } finally {
      await runtime.stop();
    }
  }, 90_000);

  it("isolates private pipes, profiles, cookies, tabs and downloads and reopens one profile", async () => {
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
      if (["/download-a", "/download-a2", "/download-b"].includes(requestPath)) {
        const value = requestPath === "/download-a" ? "A"
          : requestPath === "/download-a2" ? "A2" : "B";
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
      allowPrivateNetwork: true,
    };
    const runtimeA = new ChromeCdpRuntime(contextA, options);
    const runtimeB = new ChromeCdpRuntime(contextB, options);
    let reopened: ChromeCdpRuntime | null = null;
    try {
      await Promise.all([runtimeA.start(), runtimeB.start()]);
      await Promise.all([
        runtimeA.captureFrame(THREAD_A),
        runtimeA.captureFrame(THREAD_A2),
        runtimeB.captureFrame(THREAD_B),
      ]);
      expect(await readdir(contextA.roots.profile)).not.toContain("DevToolsActivePort");
      expect(await readdir(contextB.roots.profile)).not.toContain("DevToolsActivePort");
      await Promise.all([expectNoTcpListener(runtimeA), expectNoTcpListener(runtimeB)]);
      expect(runtimeA.targetIdFor(THREAD_A)).not.toBe(runtimeA.targetIdFor(THREAD_A2));
      expect(runtimeA.targetIdFor(THREAD_A)).not.toBe(runtimeB.targetIdFor(THREAD_B));
      expect(contextA.roots.profile).not.toBe(contextB.roots.profile);
      await Promise.all([runtimeA.takeOver(), runtimeB.takeOver()]);
      await Promise.all([
        runtimeA.navigate(THREAD_A, `${origin}/set-a`),
        runtimeB.navigate(THREAD_B, `${origin}/set-b`),
      ]);
      await Promise.all([
        runtimeA.navigate(THREAD_A, `${origin}/echo-a`),
        runtimeA.navigate(THREAD_A2, `${origin}/echo-a2`),
        runtimeB.navigate(THREAD_B, `${origin}/echo-b`),
      ]);
      await eventually(() => requests.some((item) => item.path === "/echo-a") &&
        requests.some((item) => item.path === "/echo-a2") &&
        requests.some((item) => item.path === "/echo-b"));
      expect(requests.find((item) => item.path === "/echo-a")?.cookie).toContain("profile=A");
      expect(requests.find((item) => item.path === "/echo-a")?.cookie).not.toContain("profile=B");
      expect(requests.find((item) => item.path === "/echo-b")?.cookie).toContain("profile=B");
      expect(requests.find((item) => item.path === "/echo-b")?.cookie).not.toContain("profile=A");
      expect(requests.find((item) => item.path === "/echo-a2")?.cookie).toContain("profile=A");
      await eventually(async () => (await runtimeA.currentUrl(THREAD_A)).includes("/echo-a") &&
        (await runtimeA.currentUrl(THREAD_A2)).includes("/echo-a2") &&
        (await runtimeB.currentUrl(THREAD_B)).includes("/echo-b"));
      await Promise.all([
        runtimeA.navigate(THREAD_A, `${origin}/download-a`),
        runtimeA.navigate(THREAD_A2, `${origin}/download-a2`),
        runtimeB.navigate(THREAD_B, `${origin}/download-b`),
      ]);
      const downloadsA = path.join(contextA.roots.downloads, THREAD_A);
      const downloadsA2 = path.join(contextA.roots.downloads, THREAD_A2);
      const downloadsB = path.join(contextB.roots.downloads, THREAD_B);
      await eventually(async () => (await readdir(downloadsA)).includes("A.txt") &&
        (await readdir(downloadsA2)).includes("A2.txt") &&
        (await readdir(downloadsB)).includes("B.txt"));
      expect(await readdir(downloadsA)).toEqual(["A.txt"]);
      expect(await readdir(downloadsA2)).toEqual(["A2.txt"]);
      expect(await readdir(downloadsB)).toEqual(["B.txt"]);

      const runtimeAPipe = (runtimeA as unknown as { browserClient: { close(): Promise<void> } | null })
        .browserClient;
      await runtimeAPipe?.close();
      await eventually(async () => !(await runtimeA.health()).healthy);
      await runtimeA.start();
      await runtimeA.takeOver();
      await runtimeA.navigate(THREAD_A, `${origin}/echo-a-after-pipe-eof`);
      await eventually(() => requests.some((item) => item.path === "/echo-a-after-pipe-eof"));
      expect(requests.find((item) => item.path === "/echo-a-after-pipe-eof")?.cookie)
        .toContain("profile=A");
      await expectNoTcpListener(runtimeA);
      await Promise.all([runtimeA.stop(), runtimeB.stop()]);

      reopened = new ChromeCdpRuntime({
        ...contextA,
        browserSessionId: "0198b9f0-6631-7000-8000-000000000413",
        generation: 2,
        recovering: true,
      }, options);
      await reopened.start();
      await reopened.takeOver();
      await reopened.navigate(THREAD_A, `${origin}/echo-a-reopened`);
      await eventually(() => requests.some((item) => item.path === "/echo-a-reopened"));
      expect(requests.find((item) => item.path === "/echo-a-reopened")?.cookie).toContain("profile=A");
      await reopened.stop();
    } finally {
      await Promise.allSettled([runtimeA.stop(), runtimeB.stop(), reopened?.stop()]);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);
});
