import "server-only";

import { workspacePolicyForIdentity } from "@/admin/policy-service";
import type { CatalogPrincipal } from "@/catalog/contracts";
import { CatalogRuntimeEnforcer } from "@/catalog/runtime-enforcement";
import { FileCatalogStore } from "@/catalog/store";
import { loadInstallationConfig } from "@/config/installation";

export async function catalogRuntimeEnforcer(installationId: string, userId: string) {
  const installation = await loadInstallationConfig();
  if (installation.installationId !== installationId) throw new Error("Catalog installation mismatch.");
  const effective = await workspacePolicyForIdentity(installationId, userId, installation);
  const principal: CatalogPrincipal = {
    installationId, userId, roleId: effective.roleId, groupIds: effective.groups.map(({ id }) => id),
    workspaceCanExecute: effective.policy.capabilities.execute,
  };
  const store = new FileCatalogStore(installationId, installation.paths.dataRoot);
  return new CatalogRuntimeEnforcer(await store.ensureManagedSkills(installation.catalog?.graphikAIManagedSkills ?? []), principal);
}
