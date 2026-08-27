import "server-only";

import type { AuthSession } from "@/auth/types";
import { loadInstallationConfig } from "@/config/installation";
import { LocalFileMemoryService } from "@/memory/local-file-memory-service";

export async function memoryServiceForSession(session: AuthSession) {
  const installation = await loadInstallationConfig();
  if (session.provider !== "local" || session.tenant.id !== installation.installationId) {
    throw new Error("Authenticated session does not belong to the local memory installation.");
  }
  return {
    context: {
      installationId: installation.installationId,
      userId: session.user.id,
    },
    service: new LocalFileMemoryService({ config: installation }),
  };
}
