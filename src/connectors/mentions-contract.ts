export type ConnectorMentionStatus = "connected" | "requires_login" | "admin_setup_required" | "unavailable";

/** Sanitized, per-user projection used by the composer. No provider ref or scope is exposed. */
export type ConnectorMention = {
  id: string;
  label: string;
  kind: "app" | "connector" | "mcp";
  status: ConnectorMentionStatus;
  statusCode: string | null;
  canRead: boolean;
  requiresApprovalForWrites: boolean;
};

export function isConnectorMention(value: unknown): value is ConnectorMention {
  return Boolean(value && typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" && /^[a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*$/.test((value as { id: string }).id) &&
    typeof (value as { label?: unknown }).label === "string" && (value as { label: string }).label.length > 0 &&
    ((value as { kind?: unknown }).kind === "app" || (value as { kind?: unknown }).kind === "connector" || (value as { kind?: unknown }).kind === "mcp") &&
    ((value as { status?: unknown }).status === "connected" || (value as { status?: unknown }).status === "requires_login" || (value as { status?: unknown }).status === "admin_setup_required" || (value as { status?: unknown }).status === "unavailable") &&
    ((value as { statusCode?: unknown }).statusCode === null || typeof (value as { statusCode?: unknown }).statusCode === "string") &&
    typeof (value as { canRead?: unknown }).canRead === "boolean" &&
    typeof (value as { requiresApprovalForWrites?: unknown }).requiresApprovalForWrites === "boolean");
}

export type ResolvedConnectorMention = { resource: CatalogResource; mention: ConnectorMention };

export function projectConnectorMention(
  resource: CatalogResource,
  connectorHealth: ReadonlyMap<string, { status: string; statusCode: string | null }>,
): ConnectorMention {
  const health = resource.connectorId ? connectorHealth.get(resource.connectorId) : undefined;
  const status: ConnectorMentionStatus = health
    ? health.status === "connected" ? "connected" :
      health.status === "reauth_required" ? "requires_login" :
        health.status === "not_configured" ? "admin_setup_required" : "unavailable"
    : resource.credentialMode === "personal-oauth" ? "requires_login" : "connected";
  return {
    id: resource.id,
    label: resource.label,
    kind: resource.kind as ConnectorMention["kind"],
    status,
    statusCode: health?.statusCode ?? (status === "requires_login" ? "CONNECTOR_LOGIN_REQUIRED" : null),
    canRead: status === "connected",
    requiresApprovalForWrites: resource.kind === "mcp" && Boolean(resource.mcp?.sensitiveWriteTools.length),
  };
}

export function connectorMentionDeveloperInstructions(selected: readonly ResolvedConnectorMention[]) {
  if (selected.length === 0) return "";
  return [
    "## Conectores seleccionados para este turno",
    "Estas referencias fueron autorizadas por el servidor para este usuario y este turno. Usa solamente estas fuentes conectadas; no descubras, actives, autentiques ni uses otros conectores.",
    "La lectura está limitada a las capacidades declaradas. Cualquier escritura sensible sigue requiriendo la aprobación gestionada y no se aprueba automáticamente.",
    "BEGIN AIBRAIN CONNECTOR MENTIONS",
    JSON.stringify(selected.map(({ resource, mention }) => ({
      id: resource.id,
      label: mention.label,
      kind: mention.kind,
      readTools: resource.mcp?.readTools ?? [],
      sensitiveWriteTools: resource.mcp?.sensitiveWriteTools ?? [],
      credentialMode: resource.credentialMode,
    }))),
    "END AIBRAIN CONNECTOR MENTIONS",
  ].join("\n");
}
import type { CatalogResource } from "@/catalog/contracts";
