/** Opt-in local joined acceptance. Real routes/CDP; only response delivery is fault-injected. */
import { chromium, expect, type Route } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Input = { threadId: string; command?: { event?: string; key?: string; text?: string } };
type Binding = { attachmentId: string; browserSessionId: string };
type Control = { action: string; binding?: Binding };
const origin = "https://127.0.0.1:3196";
const limit = 5_000;
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Checkpoint deadline: ${label}`)), limit);
    })]);
  } finally { clearTimeout(timer); }
}
function latch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const root = process.argv[2];
  if (process.env.AIBRAIN_JOINED_QA !== "1" || !root || !path.isAbsolute(root) ||
    !path.basename(root).startsWith("aibrain-joined-qa-")) throw new Error("Require AIBRAIN_JOINED_QA=1 and fresh joined server root");
  const evidence: { checkpoints: unknown[]; passed: boolean; error?: string } = { checkpoints: [], passed: false };
  const checkpoint = (name: string, detail: unknown = null) => {
    evidence.checkpoints.push({ name, detail });
    console.log(JSON.stringify({ checkpoint: name, detail }));
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true,
      storageState: path.join(root, "storage-0.json"), viewport: { width: 1440, height: 1000 } });
    const api = context.request;
    const status = async () => {
      const response = await api.get(`${origin}/api/runtime/browser`);
      expect(response.status()).toBe(200);
      return response.json();
    };
    expect((await (await api.get(`${origin}/api/auth/session`)).json()).session.provider).toBe("local");
    const { threads } = await (await api.get(`${origin}/api/threads`)).json();
    const thread = threads.find((item: { title: string }) => item.title === "Browser fixture");
    if (!thread) throw new Error("Missing synthetic fixture thread");
    const created = await api.post(`${origin}/api/projects/${thread.projectId}/threads`, {
      headers: { Origin: origin }, data: { title: `Recovery second thread ${Date.now()}` },
    });
    expect(created.status()).toBe(201);
    const second = (await created.json()).thread;
    const readback = async (id = thread.id): Promise<{ text: string }> =>
      JSON.parse(await readFile(path.join(root, `readback-${id}.json`), "utf8"));
    const page = await context.newPage();
    page.setDefaultTimeout(limit);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => { pageErrors.push(String(error)); checkpoint("pageerror", String(error)); });
    const inputs: Input[] = [];
    const controls: Control[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/viewer/input")) inputs.push(request.postDataJSON());
      if (request.url().endsWith("/api/runtime/browser") && request.method() === "POST") controls.push(request.postDataJSON());
    });
    // EOF wraps actual network bytes. It neither creates frames nor mocks a route result.
    await page.addInitScript({ content: `
      const state = { starts: 0, ends: [] };
      Object.assign(window, { joinedRecoveryStream: state });
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const response = await original(input, init);
        if (!url.includes("/viewer/stream?") || !response.body) return response;
        state.starts++;
        const reader = response.body.getReader();
        return new Response(new ReadableStream({
          start(controller) {
            let ended = false;
            const end = () => {
              if (ended) return;
              ended = true;
              void reader.cancel().catch(() => undefined);
              controller.close();
            };
            state.ends.push(end);
            void (async () => {
              try {
                while (!ended) {
                  const chunk = await reader.read();
                  if (ended) return;
                  if (chunk.done) { end(); return; }
                  controller.enqueue(chunk.value);
                }
              } catch (error) { if (!ended) controller.error(error); }
            })();
          },
          cancel() { return reader.cancel(); },
        }), { status: response.status, headers: response.headers });
      };
    ` });
    await page.goto(origin);
    await page.getByText("Browser fixture", { exact: true }).first().click();
    const image = page.getByAltText("Vista actual del navegador privado");
    const open = async () => {
      await page.getByRole("button", { name: "Reabrir Joined fixture" }).click();
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    };
    const clickInput = async () => {
      const bounds = await image.boundingBox();
      const size = await image.evaluate((el) => ({ w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight }));
      if (!bounds || !size.w) throw new Error("No rendered real frame");
      await page.mouse.click(bounds.x + bounds.width * 60 / size.w, bounds.y + bounds.height * 45 / size.h);
    };
    const close = async () => {
      await page.getByRole("button", { name: "Cerrar navegador", exact: true }).click();
      await expect(image).toHaveCount(0);
    };
    await open();
    await clickInput();
    // Count the exact click group, not arbitrary request totals (pointer movement is separate).
    await expect.poll(() => inputs.filter((i) => i.command?.event === "mouseReleased").length).toBe(1);
    expect(inputs.filter((i) => i.command?.event === "mousePressed")).toHaveLength(1);
    await expect(image).toBeFocused();
    expect((await readback()).text).toBe("");
    checkpoint("focused: one real mouse press/release");

    const accepted = latch<number>();
    const delivery = latch<void>();
    const finished = latch<void>();
    let interceptionError: unknown;
    let intercepted = false;
    const lostResponse = async (route: Route) => {
      const input: Input = route.request().postDataJSON();
      if (intercepted || input.command?.event !== "keyDown" || input.command.key !== "x") {
        await route.continue(); return;
      }
      intercepted = true;
      try {
        const response = await route.fetch({ timeout: limit, maxRetries: 0 });
        expect(response.status()).toBe(200);
        expect((await response.json()).ok).toBe(true);
        accepted.resolve(response.status());
        await bounded(delivery.promise, "release executed-input response");
        await route.abort("failed");
      } catch (error) {
        interceptionError = error;
        await route.abort("failed").catch(() => undefined);
      } finally { finished.resolve(); }
    };
    await page.route("**/api/runtime/browser/viewer/input", lostResponse);
    try {
      await page.keyboard.type("xyz");
      const httpStatus = await bounded(accepted.promise, "x route executed successfully");
      await expect.poll(async () => (await readback()).text).toBe("x");
      checkpoint("x executed before response loss", { httpStatus, dom: "x" });
      delivery.resolve();
      await bounded(finished.promise, "input response aborted");
      if (interceptionError) throw interceptionError;
      await expect(page.getByRole("alert").filter({ hasText: /failed|cancelada|entrada|controlar|fetch/i }).last()).toBeVisible();
      const xEvents = () => inputs.filter((i) => i.command?.key === "x");
      expect(xEvents().map((i) => i.command?.event)).toEqual(["keyDown"]);
      expect(inputs.filter((i) => ["y", "z"].includes(i.command?.key ?? ""))).toHaveLength(0);
      const streams = async () => page.evaluate(() => (window as unknown as { joinedRecoveryStream: { starts: number } }).joinedRecoveryStream.starts);
      const before = await streams();
      await page.evaluate(() => (window as unknown as { joinedRecoveryStream: { ends: Array<() => void> } }).joinedRecoveryStream.ends.forEach((end) => end()));
      await expect.poll(streams).toBeGreaterThan(before);
      await expect(image).toBeVisible();
      expect((await readback()).text).toBe("x");
      expect(xEvents()).toHaveLength(1);
      checkpoint("reconnected without replay", { streamsBefore: before, streamsAfter: await streams(), xRequests: 1, yzRequests: 0 });
      await image.focus();
      await page.keyboard.press("q");
      await expect.poll(async () => (await readback()).text).toBe("xq");
      expect(xEvents()).toHaveLength(1);
      expect(inputs.filter((i) => ["y", "z"].includes(i.command?.key ?? ""))).toHaveLength(0);
      await close();
      await expect.poll(async () => (await status()).state.lifecycle).toBe("ready");
      checkpoint("deliberate q works; close returns ready", { dom: "xq" });
    } finally {
      delivery.resolve();
      await page.unroute("**/api/runtime/browser/viewer/input", lostResponse);
    }

    async function delayedTakeover(action: "close" | "switch") {
      await open();
      const captured = latch<Binding>();
      const deliver = latch<void>();
      const done = latch<void>();
      let routeError: unknown;
      let capturedOnce = false;
      const handler = async (route: Route) => {
        const request = route.request();
        const body: Control | null = request.method() === "POST" ? request.postDataJSON() : null;
        if (capturedOnce || body?.action !== "takeover") { await route.continue(); return; }
        capturedOnce = true;
        try {
          const response = await route.fetch({ timeout: limit, maxRetries: 0 });
          expect(response.status()).toBe(200);
          expect(body.binding).toBeTruthy();
          captured.resolve(body.binding!);
          await bounded(deliver.promise, `deliver takeover after ${action}`);
          await route.fulfill({ response });
        } catch (error) { routeError = error; await route.abort().catch(() => undefined); }
        finally { done.resolve(); }
      };
      const inputCount = inputs.length;
      await page.route("**/api/runtime/browser", handler);
      try {
        await clickInput();
        await page.keyboard.type("OLD");
        const binding = await bounded(captured.promise, `${action}: real takeover accepted`);
        expect((await status()).state.lifecycle).toBe("human-control");
        checkpoint(`${action}: takeover accepted, response held`);
        if (action === "close") await close();
        else await page.getByText(second.title, { exact: true }).first().click();
        deliver.resolve();
        await bounded(done.promise, `${action}: original response delivered`);
        if (routeError) throw routeError;
        await expect.poll(() => controls.filter((c) => c.action === "release" && c.binding?.attachmentId === binding.attachmentId).length).toBe(1);
        await expect.poll(async () => (await status()).state.lifecycle).toBe("ready");
        const released = await status();
        expect(released.state.controller).toBe("agent");
        expect(released.state.browserSessionId).not.toBe(binding.browserSessionId);
        expect(inputs.slice(inputCount)).toHaveLength(0);
        checkpoint(`${action}: scoped compensation, zero old inputs, ready`);
        if (action === "switch") {
          await expect(image).toBeVisible();
          await expect.poll(async () => (await readback(second.id)).text).toBe("");
          await page.unroute("**/api/runtime/browser", handler);
          await clickInput();
          await page.keyboard.press("n");
          await expect.poll(async () => (await readback(second.id)).text).toBe("n");
          expect((await readback()).text).toBe("xq");
          expect(inputs.slice(inputCount).every((i) => i.threadId === second.id)).toBe(true);
          await close();
          await expect.poll(async () => (await status()).state.lifecycle).toBe("ready");
          checkpoint("new thread controllable; old DOM untouched; no orphan");
        }
      } finally {
        deliver.resolve();
        await page.unroute("**/api/runtime/browser", handler);
      }
    }
    await delayedTakeover("close");
    await delayedTakeover("switch");
    expect(pageErrors).toEqual([]);
    evidence.passed = true;
    await context.close();
  } catch (error) {
    evidence.error = String(error);
    throw error;
  } finally {
    await browser.close();
    await writeFile(path.join(root, "recovery-results.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
