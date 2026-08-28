import "server-only";

import type { AuthSession } from "@/auth/types";
import { loadInstallationConfig } from "@/config/installation";
import { FileAutomationStore } from "@/automations/store";

export async function automationStoreForSession(session: AuthSession) {
  if (session.provider !== "local") {
    throw new Error("Las automatizaciones requieren una instalación local persistente.");
  }
  const installation = await loadInstallationConfig();
  if (session.tenant.id !== installation.installationId) {
    throw new Error("La sesión no pertenece a esta instalación.");
  }
  return new FileAutomationStore({
    installationId: installation.installationId,
    userId: session.user.id,
    usersRoot: installation.paths.usersRoot,
  });
}
