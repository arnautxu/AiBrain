import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAuthMode } from "@/auth/session";
import { baseBrainManifest, type BrainManifest } from "@/config/brain";
import { getSeedManifest } from "@/config/tenants";
import {
  isManifestEditorData,
  manifestToEditorData,
  type ManifestEditorData,
} from "@/control-plane/types";

function dataDirectory() {
  const configured = process.env.CONTROL_PLANE_DATA_DIR?.trim();
  if (configured && !path.isAbsolute(configured)) {
    throw new Error("CONTROL_PLANE_DATA_DIR ha de ser una ruta absoluta.");
  }
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("CONTROL_PLANE_DATA_DIR persistent és obligatori en producció.");
  }
  return path.join(process.cwd(), "runtime", "control-plane");
}

function manifestPath(tenantId: string) {
  return path.join(dataDirectory(), `${tenantId}.manifest.json`);
}

async function readOverride(tenantId: string): Promise<ManifestEditorData | null> {
  try {
    const decoded: unknown = JSON.parse(await readFile(manifestPath(tenantId), "utf8"));
    return isManifestEditorData(decoded) ? decoded : null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function applyEditorData(
  seed: BrainManifest,
  data: ManifestEditorData,
  storedVersion = 1,
): BrainManifest {
  return {
    ...seed,
    version: seed.version + storedVersion,
    identity: {
      ...seed.identity,
      productName: data.productName.trim(),
      assistantName: data.assistantName.trim(),
      role: data.role.trim(),
    },
    interface: {
      ...seed.interface,
      welcomeTitle: data.welcomeTitle.trim(),
      welcomeMessage: data.welcomeMessage.trim(),
      accent: data.accent,
      density: data.density,
      corners: data.corners,
      showActivityPanel: data.showActivityPanel,
      showInspector: data.windows.inspector,
    },
    windows: seed.windows.map((window) => ({
      ...window,
      enabled: window.id === "chat" ? true : data.windows[window.id],
    })),
  };
}

function seedForTenant(tenantId: string) {
  const configured = getSeedManifest(tenantId);
  if (configured) return configured;
  if (getAuthMode() !== "supabase") return null;
  return { ...baseBrainManifest, id: `aibrain-${tenantId}` };
}

export async function loadTenantManifest(tenantId: string) {
  const seed = seedForTenant(tenantId);
  if (!seed) return null;
  // Supabase is an identity provider only. Product manifests are never read
  // from it; authenticated installations use InstallationConfig branding.
  if (getAuthMode() === "supabase") return seed;
  if (getAuthMode() !== "demo") return null;
  const override = await readOverride(tenantId);
  return override ? applyEditorData(seed, override) : seed;
}

export async function saveTenantManifest(
  tenantId: string,
  data: ManifestEditorData,
) {
  const seed = seedForTenant(tenantId);
  if (!seed) return null;
  if (getAuthMode() === "supabase") return null;
  if (getAuthMode() !== "demo") return null;
  const directory = dataDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = manifestPath(tenantId);
  const temporary = path.join(directory, `.${tenantId}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target);
  return applyEditorData(seed, data);
}

export async function loadManifestEditorData(tenantId: string) {
  const manifest = await loadTenantManifest(tenantId);
  return manifest ? manifestToEditorData(manifest) : null;
}
