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
import { ensureInstallationCatalog } from "@/catalog/baseline";
import { gmailAccessForIdentity, gmailCapabilityForSession } from "@/connectors/gmail-server-service";
import { GMAIL_CONNECTOR_ID } from "@/connectors/gmail-contracts";

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
  const state = await ensureInstallationCatalog(store, installation);
  return { installation, principal, state };
}

async function resolvedMentions(installationId: string, userId: string, session?: AuthSession) {
  const { installation, state, principal } = await catalogForIdentity(installationId, userId);
  const resources = visibleCatalogResources(state, principal)
    .filter((resource): resource is CatalogResource & { kind: "app" | "connector" | "mcp" } => resource.kind !== "skill")
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
  const health = new Map<string, { status: string; statusCode: string | null }>();
  if (session) {
    const capabilities = await Promise.all([
      codexManagedAppCapabilities(session),
      gmailCapabilityForSession(session).then((capability) => [capability]).catch(() => []),
    ]).then((groups) => groups.flat());
    for (const connector of capabilities) {
      health.set(connector.connectorId, { status: connector.status, statusCode: connector.statusCode });
    }
  } else if (resources.some((resource) => resource.connectorId === GMAIL_CONNECTOR_ID)) {
    // Turn-time revalidation has no browser session object. It still verifies
    // the exact per-user binding and encrypted token instead of trusting the
    // connector chip rendered earlier by the client.
    try {
      await gmailAccessForIdentity(installation, userId);
      health.set(GMAIL_CONNECTOR_ID, { status: "connected", statusCode: null });
    } catch (error) {
      const statusCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "GMAIL_REAUTH_REQUIRED";
      health.set(GMAIL_CONNECTOR_ID, { status: "reauth_required", statusCode });
    }
  }
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
  session?: AuthSession,
) {
  if (resourceIds.length > 20 || new Set(resourceIds).size !== resourceIds.length) {
    throw new ConnectorMentionError("CONNECTOR_MENTION_INVALID", "Las menciones de conectores no son válidas.");
  }
  if (session && (session.tenant.id !== installationId || session.user.id !== userId)) {
    throw new ConnectorMentionError("CONNECTOR_MENTION_IDENTITY_MISMATCH", "La sesión del conector no coincide con el turno.");
  }
  const { resources, mentions } = await resolvedMentions(installationId, userId, session);
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

/** Returns only catalog resources that are both currently visible and
 * callable for this identity. The turn resolver is still called afterwards,
 * so this convenience projection never becomes an authorization cache. */
export async function authorizedConnectorMentionIdsForTurn(
  session: AuthSession,
) {
  const { mentions } = await resolvedMentions(session.tenant.id, session.user.id, session);
  return mentions.filter((mention) => mention.canRead).map((mention) => mention.id);
}
