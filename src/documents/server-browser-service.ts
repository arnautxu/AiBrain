import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthSession } from "@/auth/types";
import { installationForLibraryResource } from "@/library/server-resource-access";
import { resolveProjectAccess } from "@/workbench/shared-access";
import { resolveServerTurnPermissions } from "@/runtime/permission-turn";
import { EnterpriseDocumentNetwork } from "./enterprise-document-network";
import { ServerDocumentFiles } from "./server-files";

export async function browseServerForSession(session: AuthSession, projectId: string, query: string, signal?: AbortSignal) {
  const config = await installationForLibraryResource(session);
  // Project membership is checked before source descriptors or company files.
  await resolveProjectAccess(session, projectId);
  const permissions = await resolveServerTurnPermissions(config, {
    installationId: config.installationId, userId: session.user.id, projectId, turnId: randomUUID(),
  });
  const network = new EnterpriseDocumentNetwork(config);
  const roots = await network.rootsForTurn({ userId: session.user.id, projectId, permissions });
  const result = await new ServerDocumentFiles(network, { signal }).search(roots, query, 50, true);
  if (result?.available && Array.isArray(result.results)) {
    return { ...result, results: result.results.map(entry => {
      const item = entry as Record<string, unknown>;
      const sourcePath = String(item.path);
      return { path: sourcePath, name: decodeURIComponent(sourcePath.replace(/\/$/, "").split("/").at(-1)!),
        kind: item.kind, modifiedAt: item.modifiedAt ?? null, size: item.size };
    }) };
  }
  return result ?? { available: false, warning: "No tienes acceso al servidor en este proyecto." };
}
