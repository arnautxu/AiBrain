import path from "node:path";

export type RuntimeConfig = {
  tenantId: string;
  mode: "demo" | "codex";
  codexBinary: string;
  codexHome: string | null;
  workspace: string;
  model: string | null;
  approvalPolicy: "never" | "on-request";
  sandbox: "read-only" | "workspace-write";
};

function configuredValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function absoluteRoot(value: string | null, variable: string) {
  if (value && !path.isAbsolute(value)) {
    throw new Error(`${variable} ha de ser una ruta absoluta.`);
  }
  return value;
}

export function readRuntimeConfig(tenantId: string, workspaceKey = "workspace"): RuntimeConfig {
  if (!/^[a-z0-9-]+$/.test(tenantId)) {
    throw new Error("Identificador de tenant no vàlid.");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(workspaceKey)) {
    throw new Error("Identificador de workspace no vàlid.");
  }
  const workspaceRoot = absoluteRoot(
    configuredValue(process.env.CODEX_WORKSPACE_ROOT),
    "CODEX_WORKSPACE_ROOT",
  ) ?? path.join(process.cwd(), "runtime", "tenants");
  const codexHomeRoot = absoluteRoot(
    configuredValue(process.env.CODEX_HOME_ROOT),
    "CODEX_HOME_ROOT",
  );

  return {
    tenantId,
    mode: process.env.CHAT_RUNTIME === "codex" ? "codex" : "demo",
    codexBinary: configuredValue(process.env.CODEX_BIN) ?? "codex",
    codexHome: codexHomeRoot ? path.join(codexHomeRoot, tenantId) : null,
    workspace: workspaceKey === "workspace"
      ? path.join(workspaceRoot, tenantId, "workspace")
      : path.join(workspaceRoot, tenantId, "projects", workspaceKey),
    model: configuredValue(process.env.CODEX_MODEL),
    approvalPolicy:
      process.env.CODEX_APPROVAL_POLICY === "never" ? "never" : "on-request",
    sandbox:
      process.env.CODEX_SANDBOX === "read-only" ? "read-only" : "workspace-write",
  };
}
