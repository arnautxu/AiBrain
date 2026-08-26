import "server-only";

import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { AutomationDefinition, AutomationRun } from "@/lib/automation-contract";
import type { RuntimeConfig } from "@/runtime/config";

export const automationCatalog: AutomationDefinition[] = [
  { id: "workspace-inventory", name: "Inventari del workspace", description: "Resumeix carpetes i fitxers visibles sense modificar-los.", category: "workspace", mutates: false },
  { id: "runtime-diagnostics", name: "Diagnòstic del runtime", description: "Comprova aïllament, sandbox i configuració operativa segura.", category: "runtime", mutates: false },
];

async function workspaceInventory(config: RuntimeConfig) {
  const entries = await readdir(config.workspace, { withFileTypes: true }).catch(() => []);
  const visible = entries.filter((entry) => !entry.name.startsWith(".")).slice(0, 120);
  const folders = visible.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const files = visible.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  return [
    `Workspace: ${path.basename(config.workspace)}`,
    `Carpetes: ${folders.length}`,
    folders.length ? folders.map((name) => `  / ${name}`).join("\n") : "  Cap carpeta visible",
    `Fitxers: ${files.length}`,
    files.length ? files.map((name) => `  · ${name}`).join("\n") : "  Cap fitxer visible",
  ].join("\n");
}

function runtimeDiagnostics(config: RuntimeConfig) {
  return [
    `Mode: ${config.mode}`,
    `Aïllament: ${config.codexHome ? "CODEX_HOME privat configurat" : "pendent"}`,
    `Sandbox: ${config.sandbox}`,
    `Aprovacions: ${config.approvalPolicy}`,
    `Model: ${config.model ?? "automàtic"}`,
    `Workspace: ${path.basename(config.workspace)}`,
  ].join("\n");
}

export async function executeAutomation(id: AutomationDefinition["id"], config: RuntimeConfig): Promise<AutomationRun> {
  const startedAt = new Date().toISOString();
  try {
    const output = id === "workspace-inventory" ? await workspaceInventory(config) : runtimeDiagnostics(config);
    return { id: randomUUID(), automationId: id, status: "completed", startedAt, finishedAt: new Date().toISOString(), output };
  } catch (error) {
    return { id: randomUUID(), automationId: id, status: "failed", startedAt, finishedAt: new Date().toISOString(), output: error instanceof Error ? error.message : "L’automatització ha fallat." };
  }
}
