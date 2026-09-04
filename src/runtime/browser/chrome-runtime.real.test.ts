import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { chromium } from "@playwright/test";
import type { BrowserRuntimeContext } from "@/runtime/browser/types";
import { ChromeCdpRuntime } from "@/runtime/browser/chrome-runtime";
import { PrivateCdpClient } from "@/runtime/browser/cdp-client";

function playwrightHeadlessShell() {
  const bundled = chromium.executablePath();
  const parts = bundled.split(path.sep);
  const revisionIndex = parts.findIndex((part) => /^chromium-\d+$/u.test(part));
  if (revisionIndex < 0) return undefined;
  const revision = parts[revisionIndex].slice("chromium-".length);
  const cacheRoot = parts.slice(0, revisionIndex).join(path.sep) || path.sep;
  if (process.platform === "darwin") {
    return path.join(
      cacheRoot,
      `chromium_headless_shell-${revision}`,
      `chrome-headless-shell-mac-${process.arch === "arm64" ? "arm64" : "x64"}`,
      "chrome-headless-shell",
    );
  }
  if (process.platform === "linux") {
    return path.join(cacheRoot, `chromium_headless_shell-${revision}`, "chrome-headless-shell-linux64", "chrome-headless-shell");
  }
  if (process.platform === "win32") {
    return path.join(cacheRoot, `chromium_headless_shell-${revision}`, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
  }
  return undefined;
}

const executableCandidates = [
  process.env.AIBRAIN_CHROME_EXECUTABLE,
  playwrightHeadlessShell(),
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
  it("roundtrips Unicode paste and editing keys through the real CDP adapter", async () => {
    if (!executablePath) throw new Error("A pinned Chrome executable is required.");
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-input-real-"));
    temporaryRoots.push(root);
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><title>Input</title><input id="entry" style="position:absolute;left:10px;top:10px;width:400px;height:40px"><script>entry.addEventListener("input",()=>document.title=entry.value)</script>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port.");
    const runtime = new ChromeCdpRuntime(await runtimeContext(root,
      "0198b9f0-6631-7000-8000-000000000461", "0198b9f0-6631-7000-8000-000000000462"), {
      executablePath, expectedVersion: process.env.AIBRAIN_CHROME_EXPECTED_VERSION, allowPrivateNetwork: true,
    });
    const unicode = "Català ñ 日本語 👩🏽‍💻";
    try {
      await runtime.start();
      await runtime.agentNavigate(THREAD_A, `http://127.0.0.1:${address.port}/form`);
      await runtime.takeOver();
      for (const event of ["mousePressed", "mouseReleased"] as const) {
        await runtime.dispatchInput(THREAD_A, { kind: "mouse", event, x: 30, y: 30, button: "left", clickCount: 1 });
      }
      await runtime.dispatchInput(THREAD_A, { kind: "key", event: "keyDown", key: "a", text: "a" });
      let pasteError: string | null = null;
      try { await runtime.dispatchInput(THREAD_A, { kind: "key", event: "char", key: "Unidentified", text: unicode }); }
      catch (error) { pasteError = String(error); }
      await runtime.releaseTakeover();
      const afterPaste = (await runtime.readPage(THREAD_A)).title;
      await runtime.takeOver();
      await runtime.dispatchInput(THREAD_A, { kind: "key", event: "keyDown", key: "z", code: "KeyZ", text: "z" });
      for (const event of ["keyDown", "keyUp"] as const) {
        await runtime.dispatchInput(THREAD_A, { kind: "key", event, key: "Backspace", code: "Backspace" });
      }
      await runtime.releaseTakeover();
      const afterBackspace = (await runtime.readPage(THREAD_A)).title;
      if (process.env.AIBRAIN_BROWSER_INPUT_EVIDENCE) {
        await writeFile(process.env.AIBRAIN_BROWSER_INPUT_EVIDENCE, JSON.stringify({ pasteError, afterPaste, afterBackspace }, null, 2));
      }
      expect.soft(pasteError).toBeNull();
      expect.soft(afterPaste).toBe(`a${unicode}`);
      expect.soft(afterBackspace).toBe(afterPaste);
    } finally {
      await runtime.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);

  it("measures local document readiness and reads back real viewport input", async () => {
    if (!executablePath) throw new Error("A pinned Chrome executable is required.");
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/form" });
        response.end();
        return;
      }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      if (request.url === "/delayed") {
        response.write("<!doctype html><title>Loading</title><body>");
        setTimeout(() => response.end('<p>Ready</p><script>document.title="Delayed ready"</script></body>'), 250);
        return;
      }
      const linked = request.url?.startsWith("/linked");
      response.end(`<!doctype html><title>Readiness fixture</title><body style="margin:0;height:3000px">
        <input id="entry" style="position:absolute;left:10px;top:10px;width:300px;height:40px">
        <p style="margin-top:100px">${linked ? 'A complete document with a useful link <a href="/form">next</a>' : ''}</p>
        <script>document.querySelector('#entry').addEventListener('input', event => {
          document.title = 'Typed: ' + event.target.value;
        });</script></body>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port.");
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-readiness-real-"));
    temporaryRoots.push(root);
    let evaluations = 0;
    const runtime = new ChromeCdpRuntime(await runtimeContext(root,
      "0198b9f0-6631-7000-8000-000000000451", "0198b9f0-6631-7000-8000-000000000452"), {
      executablePath,
      expectedVersion: process.env.AIBRAIN_CHROME_EXPECTED_VERSION,
      allowPrivateNetwork: true,
      connectCdpPipe(request, response, options) {
        const client = PrivateCdpClient.connect(request, response, options);
        return {
          get isOpen() { return client.isOpen; },
          send(method, params, scope) {
            if (method === "Runtime.evaluate") evaluations += 1;
            return client.send(method, params, scope);
          },
          on: client.on.bind(client),
          close: client.close.bind(client),
        };
      },
    });
    const samples: Array<{ kind: string; elapsedMs: number; readinessRpcs: number }> = [];
    try {
      await runtime.start();
      // Warm target construction is measured separately from navigation.
      await runtime.captureFrame(THREAD_A);
      for (const kind of ["linked", "form", "blank"]) {
        for (let sample = 0; sample < 3; sample += 1) {
          const before = evaluations;
          const started = performance.now();
          await runtime.agentNavigate(THREAD_A, kind === "blank" ? "about:blank" :
            `http://127.0.0.1:${address.port}/${kind}?sample=${sample}`);
          // Navigation-only: screenshot validation below is outside the timed interval.
          samples.push({ kind, elapsedMs: Math.round(performance.now() - started), readinessRpcs: evaluations - before });
          expect((await runtime.captureFrame(THREAD_A)).mediaType).toBe("image/png");
        }
      }
      await runtime.agentNavigate(THREAD_A, `http://127.0.0.1:${address.port}/form`);
      await runtime.agentNavigate(THREAD_A, `http://127.0.0.1:${address.port}/redirect`);
      expect((await runtime.readPage(THREAD_A)).url).toBe(`http://127.0.0.1:${address.port}/form`);
      const pendingNavigation = runtime.agentNavigate(THREAD_A, `http://127.0.0.1:${address.port}/delayed`);
      const queuedFrame = runtime.captureFrame(THREAD_A);
      await pendingNavigation;
      expect((await runtime.readPage(THREAD_A)).title).toBe("Delayed ready");
      expect((await queuedFrame).mediaType).toBe("image/png");
      await runtime.agentNavigate(THREAD_A, `http://127.0.0.1:${address.port}/form`);
      await runtime.takeOver();
      for (const event of ["mousePressed", "mouseReleased"] as const) {
        await runtime.dispatchInput(THREAD_A, { kind: "mouse", event, x: 30, y: 30, button: "left", clickCount: 1 });
      }
      await runtime.dispatchInput(THREAD_A, { kind: "key", event: "keyDown", key: "a", text: "a" });
      await runtime.dispatchInput(THREAD_A, { kind: "key", event: "keyUp", key: "a" });
      await runtime.dispatchInput(THREAD_A, { kind: "mouse", event: "mouseWheel", x: 400, y: 400, deltaY: 300, deltaX: 0 });
      await runtime.releaseTakeover();
      expect((await runtime.readPage(THREAD_A)).title).toBe("Typed: a");
      expect((await runtime.captureFrame(THREAD_A)).dataBase64.length).toBeGreaterThan(100);
      const evidence = { platform: process.platform, samples };
      console.info("BROWSER_READINESS_SAMPLES", JSON.stringify(evidence));
      if (process.env.AIBRAIN_BROWSER_READINESS_EVIDENCE) {
        await writeFile(process.env.AIBRAIN_BROWSER_READINESS_EVIDENCE, JSON.stringify(evidence, null, 2));
      }
    } finally {
      await runtime.stop();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 90_000);

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
      if (requestPath === "/form") {
        response.end(`<html><body style="height:3000px"><input id="entry"><button id="apply" onclick="document.querySelector('#out').textContent=document.querySelector('#entry').value">Apply</button><p id="out">empty</p><p>device-pixel-ratio:<span id="dpr"></span></p><a href="/next">Next</a><script>document.querySelector('#dpr').textContent=String(window.devicePixelRatio)</script></body></html>`);
        return;
      }
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
      await runtimeA.agentNavigate(THREAD_A, `${origin}/form`);
      await eventually(async () => (await runtimeA.readPage(THREAD_A)).text.includes("Apply"));
      await expect(runtimeA.readPage(THREAD_A)).resolves.toMatchObject({
        text: expect.stringContaining("device-pixel-ratio:1"),
      });
      await runtimeA.agentType(THREAD_A, "#entry", "real-cdp-readback", true);
      await runtimeA.agentClick(THREAD_A, "#apply");
      await eventually(async () => (await runtimeA.readPage(THREAD_A)).text.includes("real-cdp-readback"));
      await runtimeA.agentScroll(THREAD_A, 0, 500);
      await expect(runtimeA.agentCaptureFrame(THREAD_A)).resolves.toMatchObject({
        mediaType: "image/png",
        dataBase64: expect.any(String),
      });
      await Promise.all([runtimeA.takeOver(), runtimeB.takeOver()]);
      await expect(runtimeA.readPage(THREAD_A)).rejects.toMatchObject({ code: "CHROME_HUMAN_CONTROL_ACTIVE" });
      await runtimeA.releaseTakeover();
      await expect(runtimeA.readPage(THREAD_A)).resolves.toMatchObject({
        url: expect.stringContaining("/form"),
      });
      await runtimeA.takeOver();
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
