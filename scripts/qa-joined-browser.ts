/** Local-only acceptance harness. Never imported by the product. No provider auth. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import next from "next";
import { loadInstallationConfig } from "../src/config/installation";
import { UserProvisioner } from "../src/users/provisioner";
import { FileLocalSessionStore } from "../src/auth/local-session-store";
import { BrowserRuntimeRegistry } from "../src/runtime/browser/registry";
import { BrowserSessionStore } from "../src/runtime/browser/state-store";
import { BrowserGatewayTokenService } from "../src/runtime/browser/gateway-token";
import { ChromeCdpRuntime } from "../src/runtime/browser/chrome-runtime";
import { BrowserNetworkPolicy } from "../src/runtime/browser/network-policy";
import type { PrivateCdpClient } from "../src/runtime/browser/cdp-client";
import { FileWorkbenchStore } from "../src/workbench/filesystem-store";
import type { ChatMessage } from "../src/lib/chat-contract";

const cleanup: Array<() => void | Promise<void>> = [];
let cleanupPromise: Promise<void> | null = null;
function stop() {
  cleanupPromise ??= (async () => {
    const errors: unknown[] = [];
    for (const close of cleanup.reverse()) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Joined QA cleanup failed");
  })();
  return cleanupPromise;
}

async function main() {
  if (process.env.AIBRAIN_JOINED_QA !== "1") throw new Error("Explicit AIBRAIN_JOINED_QA=1 required");
  const executablePath = process.env.AIBRAIN_CHROME_BIN;
  const expectedVersion = process.env.AIBRAIN_CHROME_EXPECTED_VERSION;
  if (!executablePath || !expectedVersion) throw new Error("Pinned Chrome path/version required");
  const port = 3196;
  const origin = `https://127.0.0.1:${port}`;
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-joined-qa-"));
  const template = JSON.parse(await readFile("config/installations/playwright-isolated.example.json", "utf8"));
  const configPath = path.join(root, "installation.json");
  const paths = { dataRoot: path.join(root, "data"), companyContextRoot: path.join(root, "data/company"), usersRoot: path.join(root, "data/users"), backupsRoot: path.join(root, "data/backups"), sourceReadRoot: path.join(root, "source-ro"), publishWriteRoot: path.join(root, "publish-rw") };
  await writeFile(configPath, JSON.stringify({ ...template, installationId: "joined-browser-qa", publicUrl: origin, paths }), { mode: 0o600 });
  process.env.AIBRAIN_INSTALLATION_CONFIG = configPath;
  process.env.AIBRAIN_AUTH_MODE = "supabase";
  // Local session readback does not require an IdP. No login or model credentials are borrowed.
  delete process.env.AIBRAIN_SHARED_CODEX_AUTH_SOURCE;
  delete process.env.AIBRAIN_CODEX_AUTH_SCOPE;
  process.env.CODEX_BIN = "/usr/bin/false";
  process.env.CHAT_RUNTIME = "codex";
  const secret = randomBytes(32).toString("hex");
  process.env.AIBRAIN_BROWSER_GATEWAY_SECRET = secret;
  process.env.AIBRAIN_SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.AIBRAIN_AUTH_CHALLENGE_SECRET = randomBytes(32).toString("hex");
  // A deny-only upstream satisfies production composition without opening egress.
  const denyProxy = createServer((_request, response) => { response.writeHead(403); response.end(); });
  cleanup.push(() => { denyProxy.closeAllConnections(); denyProxy.close(); });
  denyProxy.on("connect", (_request, socket) => { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); });
  await new Promise<void>((resolve) => denyProxy.listen(3197, "127.0.0.1", resolve));
  process.env.AIBRAIN_EGRESS_PROXY_URL = "http://127.0.0.1:3197";
  process.env.AIBRAIN_EGRESS_BROWSER_TOKEN = randomBytes(32).toString("hex");
  process.env.AIBRAIN_EGRESS_WORKER_TOKEN = randomBytes(32).toString("hex");
  const config = await loadInstallationConfig();
  const sessions = new FileLocalSessionStore({ rootDirectory: path.join(config.paths.dataRoot, "sessions") });
  const users = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  process.env.AIBRAIN_ADMIN_USER_IDS = users[0];
  const threads: string[] = [];
  for (const [index, userId] of users.entries()) {
    await new UserProvisioner(config).provision({ userId, email: `qa${index}@example.test`, displayName: `QA ${index}`, requireInitialPasswordChange: false });
    const session = await sessions.create(config.installationId, userId);
    await writeFile(path.join(root, `storage-${index}.json`), JSON.stringify({ cookies: [{ name: "__Host-aibrain-session", value: session.sessionId, domain: "127.0.0.1", path: "/", expires: Math.floor(session.record.absoluteExpiresAt / 1000), httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] }), { mode: 0o600 });
    const store = FileWorkbenchStore.fromInstallation(config);
    const project = await store.createProject(userId, "Joined QA");
    const thread = await store.createThread(userId, project.id, "Browser fixture");
    threads.push(thread.id);
    const message: ChatMessage = { id: randomUUID(), role: "user", content: "Local browser fixture", status: "complete", createdAt: new Date().toISOString(), activity: [], plan: [], approvals: [], diff: "", attachments: [], artifacts: [], toolResults: [] };
    const answer: ChatMessage = { ...message, id: randomUUID(), role: "assistant", content: "Open the local fixture.", artifacts: [{ id: randomUUID(), type: "browser", name: "Joined fixture", status: "ready", control: "agent", viewerUrl: null, captureUrl: null, downloadUrl: null, error: null }] };
    await store.beginThreadTurn(userId, thread.id, message, answer);
    await store.finishThreadTurn(userId, thread.id, answer, null);
  }
  class OfflinePolicy extends BrowserNetworkPolicy {
    override async assertAllowed(url: string) {
      if (url !== "about:blank") throw new Error("Joined QA denies all network navigation");
      return super.assertAllowed(url);
    }
  }
  const html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;font:24px sans-serif;height:2500px}input{position:absolute;left:20px;top:20px;width:600px;height:50px;font:24px sans-serif}button{position:absolute;left:20px;top:100px}#count{position:absolute;left:200px;top:100px}</style><input id="text" aria-label="Fixture text"><button onclick="document.querySelector(\'#count\').textContent=String(++window.clicks)">Click</button><span id="count">0</span><script>window.clicks=0</script>';
  class FixtureChrome extends ChromeCdpRuntime {
    private seeded = new Set<string>();
    override async captureFrame(threadId: string) {
      // Fixture DOM is seeded through the owned private CDP pipe, not an application bypass route.
      const internals = this as unknown as { requireThreadPage(id: string): Promise<{ sessionId: string; targetId: string }>; requireBrowser(): PrivateCdpClient };
      const page = await internals.requireThreadPage(threadId);
      if (!this.seeded.has(page.sessionId)) {
        await internals.requireBrowser().send("Runtime.evaluate", { expression: `document.open();document.write(${JSON.stringify(html)});document.close()`, returnByValue: true }, { sessionId: page.sessionId });
        this.seeded.add(page.sessionId);
      }
      const result = await internals.requireBrowser().send<{ result: { value: unknown } }>("Runtime.evaluate", { expression: '({text:document.querySelector("#text")?.value,clicks:window.clicks,scrollY:window.scrollY})', returnByValue: true }, { sessionId: page.sessionId });
      await writeFile(path.join(root, `readback-${threadId}.json`), JSON.stringify(result.result.value), { mode: 0o600 });
      return super.captureFrame(threadId);
    }
  }
  const registry = new BrowserRuntimeRegistry({ store: new BrowserSessionStore({ config }), factory: { create: (context) => new FixtureChrome(context, { executablePath, expectedVersion, networkPolicy: new OfflinePolicy() }) } });
  cleanup.push(() => registry.close());
  const globals = globalThis as typeof globalThis & { __aibrainBrowserRuntimeService?: unknown };
  globals.__aibrainBrowserRuntimeService = { config, fingerprint: createHash("sha256").update(JSON.stringify({ schemaVersion: config.schemaVersion, installationId: config.installationId, usersRoot: config.paths.usersRoot })).digest("hex"), registry, tokens: new BrowserGatewayTokenService({ secret }), viewerStreams: new Map() };
  await registry.start(users[0]);
  const app = next({ dev: false, hostname: "127.0.0.1", port });
  cleanup.push(() => app.close());
  await app.prepare();
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(root, "key.pem"), "-out", path.join(root, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
  const server = createHttpsServer({ key: await readFile(path.join(root, "key.pem")), cert: await readFile(path.join(root, "cert.pem")) }, app.getRequestHandler());
  cleanup.push(() => { server.closeAllConnections(); server.close(); });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  console.log(JSON.stringify({ ready: true, origin, root, users, threads, auth: "real durable local sessions; test issuance, no remote IdP" }));
  process.once("SIGTERM", () => { void stop().catch((error) => { console.error(error); process.exitCode = 1; }); });
  process.once("SIGINT", () => { void stop().catch((error) => { console.error(error); process.exitCode = 1; }); });
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await stop().catch((cleanupError) => console.error(cleanupError));
});
