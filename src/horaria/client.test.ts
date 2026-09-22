import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi } from "vitest";
import type { AuthSession } from "@/auth/types";
import type { InstallationConfig } from "@/config/installation-schema";
import { callHoraria, loadHorariaConfig, type HorariaConfig } from "./client";
vi.mock("server-only", () => ({}));
const session = { provider: "local", user: { id: "user-a" }, tenant: { id: "shop-a" } } as AuthSession;
const config: HorariaConfig = { installationId: "shop-a", baseUrl: "http://127.0.0.1:1", secret: "test-only-secret-with-at-least-32-characters", users: { "user-a": { employeeId: 42, backgroundOperations: [] } }, eventsEnabled: false };
describe("private horarIA transport", () => {
  it("signs exact method, query and bytes with the server-resolved identity, and strips credentials", async () => {
    const requests: { headers: import("node:http").IncomingHttpHeaders; method?: string; url?: string; body: Buffer }[] = [];
    const server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push({ headers: req.headers, method: req.method, url: req.url, body: Buffer.concat(chunks) });
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ saved: true, passwordHash: "must-not-reach-model", nested: { access_token: "secret", visible: 1 } }));
    });
    server.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("No port");
      const actual = { ...config, baseUrl: `http://127.0.0.1:${address.port}` };
      const result = await callHoraria(actual, session, { operation: "employees.update", id: "5", query: { establecimiento: 2 }, body: { nombre: "Joan", maxHorasSemana: 20 } }, tmpdir());
      expect(result).toEqual({ saved: true, nested: { visible: 1 } });
      const request = requests[0];
      const [payload, signature] = String(request.headers["x-aibrain-authorization"]).split(".");
      expect(signature).toBe(createHmac("sha256", config.secret).update(payload).digest("base64url"));
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      expect(claims).toMatchObject({ installationId: "shop-a", actorId: "user-a", employeeId: 42, method: request.method, target: request.url, contentType: "application/json", bodyHash: createHash("sha256").update(request.body).digest("hex") });
      expect(request.headers.authorization).toBeUndefined();
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("rejects cross-installation sessions before contacting any service", async () => {
    await expect(callHoraria(config, { ...session, tenant: { id: "shop-b", name: "Other" } }, { operation: "status" }, tmpdir())).rejects.toThrow("acceso");
  });
  it("requires a private installation-bound config and refuses a symlink config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "horaria-config-"));
    try {
      await mkdir(path.join(root, "horaria"), { mode: 0o700 });
      const file = path.join(root, "horaria", "integration.json");
      const installation = { installationId: "shop-a", paths: { dataRoot: root } } as InstallationConfig;
      await writeFile(file, JSON.stringify(config), { mode: 0o600 });
      expect(await loadHorariaConfig(installation)).toEqual(config);
      await expect(loadHorariaConfig({ ...installation, installationId: "other" })).rejects.toThrow();
      await rm(file); await writeFile(path.join(root, "other.json"), JSON.stringify(config), { mode: 0o600 });
      await symlink(path.join(root, "other.json"), file);
      await expect(loadHorariaConfig(installation)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
