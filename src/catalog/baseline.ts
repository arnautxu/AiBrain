import { composioResource } from "@/connectors/composio-config";
import { managedSkillsForInstallation } from "@/catalog/managed-skills";
import type { InstallationConfig } from "@/config/installation-schema";
import { COMPANY_MAIL_CATALOG_RESOURCE } from "@/connectors/company-mail-contracts";
import { GMAIL_CATALOG_RESOURCE } from "@/connectors/gmail-contracts";
import { OUTLOOK_CATALOG_RESOURCE } from "@/connectors/outlook-contracts";
import type { FileCatalogStore } from "@/catalog/store";

export async function ensureInstallationCatalog(
  store: FileCatalogStore,
  installation: Readonly<InstallationConfig>,
) {
  const previous = await store.ensureManagedSkills(managedSkillsForInstallation(installation));
  const managed = (installation.connectors?.composio?.toolkits ?? []).map(composioResource);
  return store.ensureManagedResources(
    [
      ...managed,
      ...(installation.connectors?.companyMail?.enabled ? [COMPANY_MAIL_CATALOG_RESOURCE] : []),
      ...(installation.connectors?.gmail?.enabled ? [GMAIL_CATALOG_RESOURCE] : []),
      ...(installation.connectors?.outlook?.enabled ? [OUTLOOK_CATALOG_RESOURCE] : []),
    ],
    [COMPANY_MAIL_CATALOG_RESOURCE.id, GMAIL_CATALOG_RESOURCE.id, OUTLOOK_CATALOG_RESOURCE.id, ...managed.map(r => r.id), ...previous.resources.filter(r => r.managedBy === "graphikai" && r.connectorId?.startsWith("composio-")).map(r => r.id)],
  );
}
