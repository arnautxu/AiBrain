import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { readRegularFileWithin } from "@/security/safe-file";
import type { EnterpriseDocumentNetwork, EnterpriseDocumentRoot } from "./enterprise-document-network";

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
type ServerResult = { available: boolean; results?: unknown[]; [key: string]: unknown };
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function unavailable(): ServerResult {
  return { available: false, warning: "No se ha podido consultar el servidor. No interpretes esta falta de acceso como que el archivo o carpeta no exista." };
}
export function isServerFilePath(value: string) {
  return /^server-[a-z0-9][a-z0-9-]{0,62}\//.test(value);
}
export function isServerDirectoryQuery(value: string) {
  return value.startsWith("server:/") || /^[A-Za-z]:[\\/]/.test(value);
}
function validatePath(value: string) {
  if (value.length > 1024 || /\p{C}/u.test(value) || value.includes("\\")) throw new Error("Invalid server path");
  const [raw, query, extra] = value.split("?");
  if (extra !== undefined || (query !== undefined && !/^part=[1-9][0-9]{0,2}$/.test(query))) throw new Error("Invalid server part");
  const segments = raw.replace(/\/$/, "").split("/");
  if (!/^server-[a-z0-9][a-z0-9-]{0,62}$/.test(segments[0]) || !/^[A-Za-z]$/.test(segments[1])) throw new Error("Invalid server drive");
  for (const raw of segments.slice(2)) {
    const segment = decodeURIComponent(raw);
    if (!segment || segment.startsWith(".") || /[\\/:*?<>|"\p{C}]/u.test(segment) || /[. ]$/.test(segment)) throw new Error("Invalid server segment");
  }
}

/** A trusted app-side client; employees never receive its socket or credentials. */
export class ServerDocumentFiles {
  constructor(private readonly network: EnterpriseDocumentNetwork,
    private readonly options: { ownerUid?: number; timeoutMs?: number; signal?: AbortSignal } = {}) {}

  async search(roots: readonly EnterpriseDocumentRoot[], query: string, limit = 50) {
    if (!query.trim() || query.length > 200 || /\p{C}/u.test(query) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid server query");
    const normalized = /^[A-Za-z]:[\\/]/.test(query)
      ? `server:/${query[0]}/${query.slice(3).replaceAll("\\", "/")}` : query;
    if (normalized.startsWith("server:/")) {
      const [location, offset, extra] = normalized.slice(8).split("?");
      if (extra !== undefined || (offset !== undefined && !/^offset=[0-9]{1,6}$/.test(offset))) throw new Error("Invalid server query");
      if (location) validatePath(`server-query/${location}`);
      else if (offset !== undefined) throw new Error("Invalid server query");
    } else if (/[\\/]/.test(normalized)) throw new Error("Invalid server query");
    return this.call(roots, "search", { query, limit });
  }

  async read(roots: readonly EnterpriseDocumentRoot[], target: { scope: string; path: string }) {
    if (target.scope !== "company") throw new Error("Server file scope denied");
    validatePath(target.path);
    return this.call(roots, "read", { path: target.path });
  }

  async inventory(roots: readonly EnterpriseDocumentRoot[], target: { scope: string; path: string; offset?: number }) {
    if (target.scope !== "company" || target.path.includes("?")) throw new Error("Server inventory scope denied");
    validatePath(target.path);
    const offset = target.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 500_000) throw new Error("Invalid inventory offset");
    return this.call(roots, "inventory", { path: target.path, offset });
  }

  private async call(roots: readonly EnterpriseDocumentRoot[], operation: "search" | "read" | "inventory", input: { query: string; limit: number } | { path: string; offset?: number }): Promise<ServerResult | null> {
    await this.network.validateSyncRoots(roots);
    // Do not read even the host descriptor for a turn without company access.
    if (!roots.some((root) => root.scope === "company" && root.scopeId === null)) return null;
    if (this.options.signal?.aborted) return unavailable();
    const directory = path.join(this.network.config.paths.dataRoot, "locks", "server-files");
    try {
      const owner = this.options.ownerUid ?? 0;
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== owner || (info.mode & 0o022) || await realpath(directory) !== path.resolve(directory)) return unavailable();
      const entries = (await readdir(directory)).filter((name) => /^[a-z0-9][a-z0-9-]{0,62}\.json$/.test(name)).sort();
      if (entries.length > 8) return unavailable();
      for (const entry of entries) {
        const connection = entry.slice(0, -5);
        if ("path" in input && !input.path.startsWith(`server-${connection}/`)) continue;
        const metadata = await lstat(path.join(directory, entry));
        if (metadata.uid !== owner || (metadata.mode & 0o022)) return unavailable();
        const descriptor: unknown = JSON.parse((await readRegularFileWithin(directory, entry, 4096)).toString("utf8"));
        if (!record(descriptor) || descriptor.schemaVersion !== 1 || descriptor.connectionId !== connection ||
          !ID.test(connection) || descriptor.installationId !== this.network.config.installationId ||
          descriptor.scope !== "company" || descriptor.mode !== "read-only") return unavailable();
        const socketPath = path.join(directory, `${connection}.sock`);
        const socket = await lstat(socketPath);
        if (!socket.isSocket() || socket.uid !== owner || (socket.mode & 0o007)) return unavailable();
        return this.request(socketPath, connection, operation, input);
      }
      return null;
    } catch (error) {
      return record(error) && error.code === "ENOENT" ? null : unavailable();
    }
  }

  private request(socketPath: string, connectionId: string, operation: string, input: object): Promise<ServerResult> {
    return new Promise((resolve) => {
      const requestId = randomUUID();
      const socket = createConnection({ path: socketPath });
      let received = Buffer.alloc(0);
      let finished = false;
      const finish = (result: ServerResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.options.signal?.removeEventListener("abort", abort);
        socket.destroy();
        resolve(result);
      };
      const abort = () => finish(unavailable());
      const timer = setTimeout(abort, this.options.timeoutMs ?? 220_000);
      socket.on("error", abort);
      socket.on("end", () => { if (!finished) abort(); });
      socket.on("connect", () => {
        if (this.options.signal?.aborted) return abort();
        socket.write(JSON.stringify({ schemaVersion: 1, operation, requestId, installationId: this.network.config.installationId, connectionId, input }) + "\n");
      });
      this.options.signal?.addEventListener("abort", abort, { once: true });
      if (this.options.signal?.aborted) abort();
      socket.on("data", (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        if (received.length > 256 * 1024) return abort();
        const end = received.indexOf(10);
        if (end < 0) return;
        try {
          const value: unknown = JSON.parse(received.subarray(0, end).toString("utf8"));
          if (!record(value) || value.requestId !== requestId || value.connectionId !== connectionId || value.installationId !== this.network.config.installationId || typeof value.available !== "boolean") return abort();
          if (value.available) {
            if (typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt)) || Math.abs(Date.now() - Date.parse(value.checkedAt)) > 5 * 60_000) return abort();
            if (operation === "search" || operation === "inventory") {
              if (!Array.isArray(value.results) || value.results.length > 50) return abort();
              for (const entry of value.results) {
                if (!record(entry) || entry.scope !== "company" || typeof entry.path !== "string" || !entry.path.startsWith(`server-${connectionId}/`)) return abort();
                validatePath(entry.path);
                if (operation === "inventory" && !entry.path.toLowerCase().startsWith((input as { path: string }).path.replace(/\/$/, "").toLowerCase() + "/")) return abort();
              }
              if (operation === "inventory") {
                const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 500_000;
                const counts = (v: unknown) => record(v) && Object.keys(v).length <= 50 && Object.entries(v).every(([k, n]) => k.length <= 1024 && count(n));
                if (value.scope !== "company" || value.path !== (input as { path: string }).path ||
                  value.countBasis !== "observed-files-in-folder-tree" || value.businessRecordCount !== null || value.snapshot !== false ||
                  value.sourceChecked !== false || typeof value.enumerationComplete !== "boolean" || !count(value.fileCount) ||
                  !counts(value.directories) || !counts(value.fileTypes) || !counts(value.folders) ||
                  !(value.nextOffset === null || count(value.nextOffset) && Number(value.nextOffset) === Number((input as { offset: number }).offset) + 50)) return abort();
              }
            } else if (typeof value.content !== "string" || Buffer.byteLength(value.content) > 120 * 1024 || value.scope !== "company" || value.path !== (input as { path: string }).path) return abort();
          }
          const { requestId: _request, installationId: _installation, connectionId: _connection, ...result } = value;
          finish(result as ServerResult);
        } catch { abort(); }
      });
    });
  }
}
