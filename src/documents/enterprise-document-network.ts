import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import type { ResolvedPermissions } from "@/permissions";
import { atomicWriteFile } from "@/storage";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DEPTH = 12;
const MAX_ENTRIES = 10_000;
const MAX_INDEXED_BYTES = 512 * 1024;
const MAX_QUERY_LENGTH = 200;

export type EnterpriseDocumentScope = "company" | "project" | "private";

export type EnterpriseDocumentRoot = Readonly<{
  scope: EnterpriseDocumentScope;
  path: string;
  readOnly: boolean;
}>;

export type EnterpriseDocumentSearchResult = Readonly<{
  scope: EnterpriseDocumentScope;
  path: string;
  size: number;
  sha256: string;
  provenance: Readonly<{ installationId: string; projectId: string | null; userId: string | null }>;
}>;

export class EnterpriseDocumentNetworkError extends Error {
  constructor(readonly code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "EnterpriseDocumentNetworkError";
  }
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertId(value: string, label: string) {
  if (!USER_ID.test(value)) throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_ID_INVALID", `${label} is invalid.`);
  return value;
}

function scopeRule(scope: EnterpriseDocumentScope, operation: "read" | "write") {
  return `documents.${scope}.${operation}`;
}

function permissionAllows(
  permissions: ResolvedPermissions,
  scope: EnterpriseDocumentScope,
  operation: "read" | "write",
) {
  const action = operation === "read" ? "consult" : "execute";
  const ruleIds = [scopeRule(scope, operation), `documents.${operation}`];
  const matches = permissions.rules.filter((rule) => rule.action === action && ruleIds.includes(rule.ruleId));
  if (matches.some((rule) => rule.effect === "deny")) return false;
  return matches.some((rule) => rule.effect === "allow");
}

async function secureDirectory(root: string, target: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!inside(resolvedRoot, resolvedTarget)) {
    throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_PATH_ESCAPE", "Document root escapes its installation data root.");
  }
  await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
  const rootMetadata = await lstat(resolvedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_SYMLINK_REJECTED", "Document network root must be a real directory.");
  }
  const canonicalRoot = await realpath(resolvedRoot);
  let current = resolvedRoot;
  const relative = path.relative(resolvedRoot, resolvedTarget);
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    await mkdir(current, { recursive: true, mode: 0o700 });
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_SYMLINK_REJECTED", "Document network directories must not be symbolic links.");
    }
    if (!inside(canonicalRoot, await realpath(current))) {
      throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_PATH_ESCAPE", "Document network resolves outside its installation root.");
    }
  }
}

/**
 * The network lives below dataRoot, never beside it: each installation therefore
 * gets a persistent, volume-backed root without handing a worker its dataRoot,
 * credentials, configuration or any host path.
 */
export function enterpriseDocumentNetworkRoot(config: Readonly<InstallationConfig>) {
  return path.join(path.resolve(config.paths.dataRoot), "enterprise-documents");
}

export class EnterpriseDocumentNetwork {
  readonly root: string;

  constructor(readonly config: Readonly<InstallationConfig>) {
    this.root = enterpriseDocumentNetworkRoot(config);
  }

  companyRoot() {
    return path.join(this.root, "company", "shared");
  }

  projectRoot(projectId: string) {
    return path.join(this.root, "projects", assertId(projectId, "projectId"), "shared");
  }

  privateRoot(userId: string) {
    return path.join(this.root, "users", assertId(userId, "userId"), "private");
  }

  async provision(input: { userId: string; projectId: string }) {
    assertId(input.userId, "userId");
    assertId(input.projectId, "projectId");
    for (const [scope, directory, provenance] of [
      ["company", this.companyRoot(), { installationId: this.config.installationId, projectId: null, userId: null }],
      ["project", this.projectRoot(input.projectId), { installationId: this.config.installationId, projectId: input.projectId, userId: null }],
      ["private", this.privateRoot(input.userId), { installationId: this.config.installationId, projectId: null, userId: input.userId }],
    ] as const) {
      await secureDirectory(this.root, directory);
      await atomicWriteFile(path.join(directory, ".aibrain-document-scope.json"), `${JSON.stringify({
        schemaVersion: 1,
        scope,
        ...provenance,
      }, null, 2)}\n`, { mode: 0o600 });
    }
  }

  async rootsForTurn(input: { userId: string; projectId: string; permissions: ResolvedPermissions }) {
    assertId(input.userId, "userId");
    assertId(input.projectId, "projectId");
    if (input.permissions.installationId !== this.config.installationId ||
        input.permissions.userId !== input.userId || input.permissions.projectId !== input.projectId) {
      throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_PERMISSION_BINDING", "Document network permissions do not belong to this turn.");
    }
    await this.provision(input);
    const roots: EnterpriseDocumentRoot[] = [];
    for (const [scope, directory] of [
      ["company", this.companyRoot()],
      ["project", this.projectRoot(input.projectId)],
      ["private", this.privateRoot(input.userId)],
    ] as const) {
      if (!permissionAllows(input.permissions, scope, "read")) continue;
      roots.push(Object.freeze({
        scope,
        path: directory,
        readOnly: !permissionAllows(input.permissions, scope, "write"),
      }));
    }
    return Object.freeze(roots);
  }

  async search(input: { roots: readonly EnterpriseDocumentRoot[]; query: string; limit?: number }) {
    const query = input.query.trim().toLocaleLowerCase();
    if (!query || query.length > MAX_QUERY_LENGTH || /[\0/\\]/u.test(query)) {
      throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_QUERY_INVALID", "Document search query is invalid.");
    }
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_QUERY_INVALID", "Document search limit is invalid.");
    }
    const results: EnterpriseDocumentSearchResult[] = [];
    for (const root of input.roots) {
      const canonicalRoot = await realpath(root.path);
      const visit = async (directory: string, depth: number): Promise<void> => {
        if (depth > MAX_DEPTH || results.length >= limit) return;
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= limit || entry.name.startsWith(".")) continue;
          const candidate = path.join(directory, entry.name);
          const metadata = await lstat(candidate);
          if (metadata.isSymbolicLink()) throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_SYMLINK_REJECTED", "Document search refuses symbolic links.");
          if (metadata.isDirectory()) {
            if (!inside(canonicalRoot, await realpath(candidate))) throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_PATH_ESCAPE", "Document directory escapes its scope.");
            await visit(candidate, depth + 1);
            continue;
          }
          if (!metadata.isFile() || metadata.size > MAX_INDEXED_BYTES) continue;
          const relative = path.relative(canonicalRoot, candidate).split(path.sep).join("/");
          const haystack = `${relative}\n${(await readFile(candidate, "utf8").catch(() => "")).slice(0, MAX_INDEXED_BYTES)}`.toLocaleLowerCase();
          if (!haystack.includes(query)) continue;
          results.push(Object.freeze({
            scope: root.scope,
            path: relative,
            size: metadata.size,
            sha256: createHash("sha256").update(await readFile(candidate)).digest("hex"),
            provenance: Object.freeze({
              installationId: this.config.installationId,
              projectId: root.scope === "project" ? path.basename(path.dirname(path.dirname(root.path))) : null,
              userId: root.scope === "private" ? path.basename(path.dirname(path.dirname(root.path))) : null,
            }),
          }));
          if (results.length > MAX_ENTRIES) throw new EnterpriseDocumentNetworkError("DOCUMENT_NETWORK_LIMIT", "Document network contains too many matching files.");
        }
      };
      await visit(canonicalRoot, 0);
    }
    return Object.freeze(results);
  }
}
