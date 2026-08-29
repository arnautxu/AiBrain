import "server-only";

import { workspacePolicyForIdentity } from "@/admin/policy-service";
import type { CatalogPrincipal, CatalogResource } from "@/catalog/contracts";
import { visibleCatalogResources } from "@/catalog/resolver";
import { FileCatalogStore } from "@/catalog/store";
import type { AuthSession } from "@/auth/types";
import { loadInstallationConfig } from "@/config/installation";
import { codexManagedAppCapabilities } from "@/connectors/server-service";
import {
  projectConnectorMention,
} from "@/connectors/mentions-contract";

export type { ConnectorMention, ConnectorMentionStatus, ResolvedConnectorMention } from "@/connectors/mentions-contract";

export class ConnectorMentionError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ConnectorMentionError"; }
}

async function catalogForIdentity(installationId: string, userId: string) {
  const installation = await loadInstallationConfig();
  if (installation.installationId !== installationId) {
    throw new ConnectorMentionError("CONNECTOR_MENTION_TENANT_MISMATCH", "La instalación no coincide con la sesión.");
  }
  const workspace = await workspacePolicyForIdentity(installationId, userId, installation);
  const principal: CatalogPrincipal = {
    installationId,
    userId,
    roleId: workspace.roleId,
    groupIds: workspace.groups.map(({ id }) => id),
    workspaceCanExecute: workspace.policy.capabilities.execute,
  };
  const store = new FileCatalogStore(installationId, installation.paths.dataRoot);
  const state = await store.ensureManagedSkills(installation.catalog?.graphikAIManagedSkills ?? []);
  return { principal, state };
}

async function resolvedMentions(installationId: string, userId: string, session?: AuthSession) {
  const { state, principal } = await catalogForIdentity(installationId, userId);
  const health = new Map<string, { status: string; statusCode: string | null }>();
  if (session) {
    for (const connector of await codexManagedAppCapabilities(session)) {
      health.set(connector.connectorId, { status: connector.status, statusCode: connector.statusCode });
    }
  }
  const resources = visibleCatalogResources(state, principal)
    .filter((resource): resource is CatalogResource & { kind: "app" | "connector" | "mcp" } => resource.kind !== "skill")
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
  return { resources, mentions: resources.map((resource) => projectConnectorMention(resource, health)) };
}

export async function connectorMentionsForSession(session: AuthSession) {
  const { mentions } = await resolvedMentions(session.tenant.id, session.user.id, session);
  return { schemaVersion: 1 as const, mentions };
}

/**
 * Re-resolves client supplied IDs from the authenticated catalog immediately
 * before thread start. This makes a rendered @ chip an authority reference,
 * not decorative text: revoked, role-hidden or unconnected resources fail
 * closed even if the browser has stale autocomplete data.
 */
export async function resolveConnectorMentionsForTurn(
  installationId: string,
  userId: string,
  resourceIds: readonly string[],
) {
  if (resourceIds.length > 20 || new Set(resourceIds).size !== resourceIds.length) {
    throw new ConnectorMentionError("CONNECTOR_MENTION_INVALID", "Las menciones de conectores no son válidas.");
  }
  const { resources, mentions } = await resolvedMentions(installationId, userId);
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const projected = new Map(mentions.map((mention) => [mention.id, mention]));
  const selected = resourceIds.map((id) => {
    const resource = byId.get(id);
    const mention = projected.get(id);
    if (!resource || !mention) {
      throw new ConnectorMentionError("CONNECTOR_MENTION_DENIED", "Un conector seleccionado ya no está autorizado para este usuario.");
    }
    if (!mention.canRead) {
      throw new ConnectorMentionError("CONNECTOR_MENTION_NOT_CONNECTED", "El conector seleccionado requiere iniciar sesión o no está disponible.");
    }
    return { resource, mention };
  });
  return selected;
}
