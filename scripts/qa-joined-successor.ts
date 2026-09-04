/** Opt-in real joined-app successor check. No inference or external navigation. */
import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.argv[2];
  if (process.env.AIBRAIN_JOINED_QA !== "1" || !root || !path.isAbsolute(root) || !path.basename(root).startsWith("aibrain-joined-qa-")) throw new Error("Fresh joined QA root required");
  const checkpoints: string[] = [];
  const mark = (s: string) => { checkpoints.push(s); console.log(s); };
  const browser = await chromium.launch({ headless: true });
  let release = () => {};
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, storageState: path.join(root, "storage-0.json"), viewport: { width: 1440, height: 1000 } });
    const origin = "https://127.0.0.1:3196";
    const status = async () => (await context.request.get(`${origin}/api/runtime/browser`)).json();
    const post = (data: unknown) => context.request.post(`${origin}/api/runtime/browser`, { headers: { Origin: origin }, data });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const controls: Array<{ action: string; binding?: { attachmentId: string } }> = [];
    page.on("request", r => { if (r.url().endsWith("/api/runtime/browser") && r.method() === "POST") controls.push(r.postDataJSON()); });
    await page.goto(origin);
    await page.getByText("Browser fixture", { exact: true }).first().click();
    let old: { attachmentId: string } | undefined;
    let error: unknown;
    let delivered = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    // Install before opening: pointer movement on an opened frame can acquire control.
    await page.route("**/api/runtime/browser", async route => {
      const r = route.request();
      const body = r.method() === "POST" ? r.postDataJSON() : null;
      if (old || body?.action !== "takeover") { await route.continue(); return; }
      try {
        mark("takeover request intercepted");
        const response = await route.fetch({ timeout: 5000, maxRetries: 0 });
        expect(response.status()).toBe(200);
        old = body.binding;
        mark("takeover accepted; delivery held");
        await gate;
        await route.fulfill({ response });
        delivered = true;
      } catch (e) { error = e; await route.abort().catch(() => {}); }
    });
    await page.getByRole("button", { name: "Reabrir Joined fixture" }).click();
    const frame = page.getByAltText("Vista actual del navegador privado");
    await expect(frame).toBeVisible();
    await expect.poll(() => frame.evaluate(e => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await frame.click({ position: { x: 30, y: 30 } });
    await expect.poll(() => { if (error) throw error; return !!old; }, { message: "takeover accepted checkpoint", timeout: 5000 }).toBe(true);
    await page.getByRole("button", { name: "Cerrar navegador", exact: true }).click();
    await expect(frame).toHaveCount(0);
    const successor = { attachmentId: randomUUID(), browserSessionId: (await status()).state.browserSessionId };
    expect((await post({ action: "takeover", binding: successor })).status()).toBe(200);
    mark("successor acquired before old response");
    release();
    await expect.poll(() => { if (error) throw error; return delivered; }, { message: "old delivery checkpoint", timeout: 5000 }).toBe(true);
    await expect.poll(() => controls.filter(c => c.action === "release" && c.binding?.attachmentId === old?.attachmentId).length).toBe(1);
    expect((await status()).state.lifecycle).toBe("human-control");
    expect((await post({ action: "heartbeat", binding: successor })).status()).toBe(200);
    expect((await post({ action: "release", binding: successor })).status()).toBe(200);
    await expect.poll(async () => (await status()).state.lifecycle).toBe("ready");
    mark("old scoped release preserves successor; final ready");
  } finally {
    release();
    await browser.close();
    await writeFile(path.join(root, "successor-checkpoints.json"), JSON.stringify(checkpoints, null, 2), { mode: 0o600 });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
