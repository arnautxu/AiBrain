import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import { ResourceLockManager } from "@/storage";
import { ComposioApi, ComposioError, object } from "./composio-api";
import type { ComposioToolkitConfig } from "./composio-config";

export const ON_CONNECT = "on-connect";
/** Scope/version changes get a new receipt; never reuse a broader auth config. */
function location(config: Readonly<InstallationConfig>, toolkit: ComposioToolkitConfig) {
  const fingerprint = createHash("sha256").update(JSON.stringify([config.installationId, toolkit.slug, toolkit.scopes, toolkit.readTools])).digest("hex");
  const root = path.join(config.paths.dataRoot, "connectors", "composio", "auth-configs");
  return { root, file: path.join(root, `${fingerprint}.json`), fingerprint };
}
export async function resolveComposioToolkit(config: Readonly<InstallationConfig>, toolkit: ComposioToolkitConfig) {
  if (toolkit.authConfigId !== ON_CONNECT) return toolkit;
  const { file, fingerprint } = location(config, toolkit);
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!object(value) || value.installationId !== config.installationId || value.fingerprint !== fingerprint || typeof value.authConfigId !== "string" || !/^ac_[A-Za-z0-9_-]{1,120}$/.test(value.authConfigId)) throw new ComposioError("COMPOSIO_AUTH_CONFIG_RECEIPT_INVALID");
    return { ...toolkit, authConfigId: value.authConfigId };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return toolkit;
    throw error;
  }
}
/** Called only after the authenticated catalog gate, on an explicit Connect. */
export async function provisionComposioToolkit(config: Readonly<InstallationConfig>, toolkit: ComposioToolkitConfig, fetcher?: typeof fetch) {
  if (toolkit.authConfigId !== ON_CONNECT) return toolkit;
  const { root, file, fingerprint } = location(config, toolkit);
  const lock = new ResourceLockManager({ rootDirectory: path.join(root, "locks"), defaultTimeoutMs: 30_000 });
  return lock.withLock(fingerprint, async () => {
    const existing = await resolveComposioToolkit(config, toolkit);
    if (existing.authConfigId !== ON_CONNECT) return existing;
    const api = new ComposioApi(process.env.AIBRAIN_COMPOSIO_CATALOG_API_KEY ?? "", fetcher);
    const metadata = await api.request(`/toolkits/${toolkit.slug}`);
    if (metadata.slug !== toolkit.slug || !Array.isArray(metadata.composio_managed_auth_schemes) || !metadata.composio_managed_auth_schemes.includes("OAUTH2")) throw new ComposioError("COMPOSIO_MANAGED_AUTH_UNAVAILABLE");
    const result = await api.request("/auth_configs", "POST", { toolkit: { slug: toolkit.slug }, auth_config: { type: "use_composio_managed_auth", name: `AiBrain ${toolkit.label} ${fingerprint.slice(0, 12)}`, credentials: { scopes: toolkit.scopes.join(",") } } });
    const id = object(result.auth_config) ? result.auth_config.id : result.id;
    if (typeof id !== "string" || !/^ac_[A-Za-z0-9_-]{1,120}$/.test(id)) throw new ComposioError("COMPOSIO_AUTH_CONFIG_INVALID");
    const resolved = { ...toolkit, authConfigId: id };
    await api.verifyConfig(resolved);
    const verified = await api.request(`/auth_configs/${id}`);
    const granted = object(verified.credentials) && typeof verified.credentials.scopes === "string" ? verified.credentials.scopes.split(",").map(s => s.trim()).filter(Boolean).sort() : [];
    if (JSON.stringify(granted) !== JSON.stringify([...toolkit.scopes].sort())) throw new ComposioError("COMPOSIO_AUTH_CONFIG_SCOPE_MISMATCH");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ installationId: config.installationId, fingerprint, authConfigId: id }), { mode: 0o600, flag: "wx" });
    await rename(temp, file);
    return resolved;
  });
}
