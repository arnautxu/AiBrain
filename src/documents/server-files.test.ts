import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseInstallationConfig } from "@/config/installation-schema";
import type { ResolvedPermissions } from "@/permissions";
import { EnterpriseDocumentNetwork } from "./enterprise-document-network";
import { ServerDocumentFiles } from "./server-files";
import { handleCompanyFilesDynamicToolCall } from "@/runtime/enterprise-documents/dynamic-tools";

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000002";
const temporary: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(allow = true, reply?: (request: Record<string, unknown>) => object | null) {
  const root = await realpath(await mkdtemp("/tmp/ab-files-"));
  temporary.push(root);
  const dataRoot = path.join(root, "data");
  const config = parseInstallationConfig({ schemaVersion: 1, installationId: "files-test", companyName: "Test", companySlug: "test",
    publicUrl: "https://example.test", branding: { productName: "Test", logoPath: "/logo.svg", faviconPath: "/favicon.svg", accentColor: "#123456" },
    paths: { dataRoot, companyContextRoot: path.join(dataRoot, "context"), usersRoot: path.join(dataRoot, "users"),
      sourceReadRoot: path.join(root, "source"), publishWriteRoot: path.join(root, "publish"), backupsRoot: path.join(dataRoot, "backups") } });
  const network = new EnterpriseDocumentNetwork(config);
  const permissions: ResolvedPermissions = { schemaVersion: 1, installationId: config.installationId, userId: USER, roleId: null,
    projectId: PROJECT, turnId: "00000000-0000-4000-8000-000000000003", resolvedAt: new Date().toISOString(), fingerprint: "a".repeat(64),
    sources: [], developerInstructions: "Test", rules: [{ ruleId: "documents.company.read", action: "consult", effect: allow ? "allow" : "deny",
      instruction: "Test", sourceScope: "installation", sourcePolicyVersion: 1, precedence: 100 }] };
  const roots = await network.rootsForTurn({ userId: USER, projectId: PROJECT, permissions });
  const directory = path.join(dataRoot, "locks/server-files");
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const descriptor = path.join(directory, "arnall.json");
  await writeFile(descriptor, JSON.stringify({ schemaVersion: 1, installationId: config.installationId, connectionId: "arnall",
    scope: "company", mode: "read-only" }), { mode: 0o440 });
  const requests: Record<string, unknown>[] = [];
  const server = createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (!data.includes("\n")) return;
      const request = JSON.parse(data) as Record<string, unknown>;
      requests.push(request);
      const result = reply ? reply(request) : { available: true, results: [], checkedAt: new Date().toISOString() };
      if (result) socket.end(JSON.stringify({ requestId: request.requestId, connectionId: request.connectionId, installationId: request.installationId, ...result }) + "\n");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path.join(directory, "arnall.sock"), resolve));
  await chmod(path.join(directory, "arnall.sock"), 0o660);
  const options = { ownerUid: process.getuid?.() ?? 0, timeoutMs: 100 };
  const files = new ServerDocumentFiles(network, options);
  const tool = (name: string, args: object) => handleCompanyFilesDynamicToolCall({ namespace: "aibrain_company_files", tool: name,
    threadId: "thread", turnId: "turn", callId: "call", arguments: args } as never,
    { network, roots, serverFiles: files, runtimeThreadId: "thread", runtimeTurnId: "turn" });
  return { network, roots, files, tool, descriptor, requests, options };
}

describe("server document file access", () => {
  it("caps oversized positive page sizes from the runtime before contacting the server", async () => {
    const f = await fixture();
    const response = await f.tool("search", { query: "server:/Y/PRESSUPOSTOS", limit: 100 });
    expect(response.success).toBe(true);
    expect(f.requests[0]).toMatchObject({ operation: "search", input: { query: "server:/Y/PRESSUPOSTOS", limit: 50 } });
    await f.tool("search", { query: "PRESSUPOSTOS", limit: 100 });
    expect(f.requests[1]).toMatchObject({ operation: "search", input: { query: "PRESSUPOSTOS", limit: 50 } });
    for (const limit of [0, -1, 1.5, "100"]) {
      const invalid = await f.tool("search", { query: "server:/", limit });
      expect(invalid.success).toBe(false);
      expect(JSON.stringify(invalid)).toContain("Parámetros de búsqueda no válidos");
    }
    expect(f.requests).toHaveLength(2);
  });

  it("browses folders outside the old import using the existing chat tool schema", async () => {
    const f = await fixture(true, () => ({ available: true, checkedAt: new Date().toISOString(), results: [
      { scope: "company", path: "server-arnall/Y/PRESSUPOSTOS/Oferta.pdf", kind: "file", size: 42 },
    ], nextQuery: "server:/Y/PRESSUPOSTOS?offset=50", truncated: true }));
    const response = await f.tool("search", { query: "server:/Y/PRESSUPOSTOS" });
    expect(response.success).toBe(true);
    expect(JSON.stringify(response)).toContain("server-arnall/Y/PRESSUPOSTOS/Oferta.pdf");
    expect(JSON.stringify(response)).toContain("offset=50");
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({ operation: "search", input: { query: "server:/Y/PRESSUPOSTOS", limit: 50 } });
  });

  it("reads the current server file without requiring a local synchronized copy", async () => {
    const file = "server-arnall/Y/PRESSUPOSTOS/Oferta.pdf";
    const f = await fixture(true, () => ({ available: true, checkedAt: new Date().toISOString(), scope: "company", path: file,
      content: "Pressupost vigent", sha256: "a".repeat(64) }));
    const response = await f.tool("read", { scope: "company", path: file });
    expect(JSON.stringify(response)).toContain("Pressupost vigent");
    expect(f.requests[0]).toMatchObject({ operation: "read", input: { path: file } });
  });

  it("keeps local content search while adding live server filename matches", async () => {
    const f = await fixture(true, () => ({ available: true, checkedAt: new Date().toISOString(), results: [
      { scope: "company", path: "server-arnall/Z/PRESSUPOSTOS/Oferta.pdf", kind: "file", size: 42 },
    ], limited: true }));
    await writeFile(path.join(f.network.companyRoot(), "note.txt"), "Pressupostos");
    const response = await f.tool("search", { query: "pressupostos" });
    expect(JSON.stringify(response)).toContain("note.txt");
    expect(JSON.stringify(response)).toContain("server-arnall/Z/");
  });

  it("never contacts the server for denied company roots, forged scopes, traversal or invalid queries", async () => {
    const denied = await fixture(false);
    expect(await denied.files.search(denied.roots, "server:/")).toBeNull();
    expect(denied.requests).toHaveLength(0);
    const f = await fixture();
    await expect(f.files.search([{ scope: "company", scopeId: null, path: f.network.companyRoot(), readOnly: true }], "server:/"))
      .rejects.toMatchObject({ code: "DOCUMENT_NETWORK_ROOT_NOT_AUTHORIZED" });
    for (const query of ["../x", "server:/Y/../x", "server:/Y/a%2fb", "server:/Y?offset=bad"]) {
      expect((await f.tool("search", { query })).success).toBe(false);
    }
    expect((await f.tool("read", { scope: "private", path: "server-arnall/Y/a.txt" })).success).toBe(false);
    expect((await f.tool("read", { scope: "company", path: "server-arnall/Y/%2e%2e/a.txt" })).success).toBe(false);
    expect(f.requests).toHaveLength(0);
  });

  it("rejects replies bound to another installation and mismatched read paths", async () => {
    const f = await fixture(true, () => ({ available: true, installationId: "other", checkedAt: new Date().toISOString(), results: [] }));
    expect(await f.files.search(f.roots, "server:/")).toMatchObject({ available: false });
    const read = await fixture(true, () => ({ available: true, scope: "company", path: "server-arnall/Y/other.txt", content: "foreign", checkedAt: new Date().toISOString() }));
    expect(await read.files.read(read.roots, { scope: "company", path: "server-arnall/Y/a.txt" })).toMatchObject({ available: false });
  });

  it("honors cancellation and bounds unresponsive source requests", async () => {
    const f = await fixture(true, () => null);
    const controller = new AbortController();
    controller.abort();
    const files = new ServerDocumentFiles(f.network, { ...f.options, signal: controller.signal });
    expect(await files.search(f.roots, "server:/")).toMatchObject({ available: false });
    expect(f.requests).toHaveLength(0);
    expect(await f.files.search(f.roots, "server:/")).toMatchObject({ available: false });
    expect(f.requests).toHaveLength(1);
  });
});
