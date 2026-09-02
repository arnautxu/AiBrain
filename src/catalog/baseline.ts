import { managedSkillsForInstallation } from "@/catalog/managed-skills";
import type { InstallationConfig } from "@/config/installation-schema";
import { GMAIL_CATALOG_RESOURCE } from "@/connectors/gmail-contracts";
import { OUTLOOK_CATALOG_RESOURCE } from "@/connectors/outlook-contracts";
import type { FileCatalogStore } from "@/catalog/store";

export async function ensureInstallationCatalog(
  store: FileCatalogStore,
  installation: Readonly<InstallationConfig>,
) {
  await store.ensureManagedSkills(managedSkillsForInstallation(installation));
  return store.ensureManagedResources(
    [
      ...(installation.connectors?.gmail?.enabled ? [GMAIL_CATALOG_RESOURCE] : []),
      ...(installation.connectors?.outlook?.enabled ? [OUTLOOK_CATALOG_RESOURCE] : []),
    ],
    [GMAIL_CATALOG_RESOURCE.id, OUTLOOK_CATALOG_RESOURCE.id],
  );
}
