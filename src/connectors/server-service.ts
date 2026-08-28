import "server-only";

import type { AuthSession } from "@/auth/types";
import { workspacePolicyForIdentity } from "@/admin/policy-service";
import { FileConnectorBindingStore } from "@/connectors/binding-store";
import { codexManagedAppRegistration } from "@/connectors/codex-managed-app-provider";
import type { ConnectorCapabilitySnapshot } from "@/connectors/contracts";
import { ConnectorRegistry } from "@/connectors/registry";
import { loadInstallationConfig } from "@/config/installation";
import { workerAppServerForUser } from "@/runtime/worker-runtime-service";

/**
 * The principal is always derived from the authenticated server session and
 * durable workspace role. There is deliberately no request-body equivalent.
 */
export async function codexManagedAppCapabilities(
  session: AuthSession,
): Promise<ConnectorCapabilitySnapshot[]> {
  const installation = await loadInstallationConfig();
  if (installation.installationId !== session.tenant.id) {
    throw new Error("Authenticated installation does not match connector storage.");
  }
  const workspacePolicy = await workspacePolicyForIdentity(
    installation.installationId,
    session.user.id,
    installation,
  );
  const registry = new ConnectorRegistry(
    new FileConnectorBindingStore(installation.installationId, installation.paths.dataRoot),
    [codexManagedAppRegistration(async (userId) => (await workerAppServerForUser(userId)).client)],
  );
  return registry.capabilities({
    installationId: installation.installationId,
    userId: session.user.id,
    roleId: workspacePolicy.roleId,
  }, { allowSharedCredentials: false });
}
