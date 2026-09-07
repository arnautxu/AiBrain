import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthSession } from "@/auth/types";
import { installationForLibraryResource } from "@/library/server-resource-access";
import { resolveProjectAccess } from "@/workbench/shared-access";
import { resolveServerTurnPermissions } from "@/runtime/permission-turn";
import { EnterpriseDocumentNetwork } from "./enterprise-document-network";
import { ServerBrowseInflight } from "./server-browse-inflight";
import { ServerDocumentFiles } from "./server-files";

const inFlight = new ServerBrowseInflight();

export async function browseServerForSession(session: AuthSession, projectId: string, query: string, signal?: AbortSignal) {
  const config = await installationForLibraryResource(session);
  // Project membership is checked before source descriptors or company files.
  await resolveProjectAccess(session, projectId);
  const permissions = await resolveServerTurnPermissions(config, {
    installationId: config.installationId, userId: session.user.id, projectId, turnId: randomUUID(),
  });
  const network = new EnterpriseDocumentNetwork(config);
  const roots = await network.rootsForTurn({ userId: session.user.id, projectId, permissions });
  if (signal?.aborted) return { available: false, error: "SERVER_BROWSE_CANCELLED" };
  // An HTTP disconnect must not orphan the Windows operation and make a reopen
  // start a competing session. Every subscriber has independently passed ACLs.
  // Include resolved roots so a permissions change cannot reuse an older grant.
  const key = JSON.stringify([config.installationId, session.user.id, projectId, roots, query]);
  const result = await inFlight.run(key, () => new ServerDocumentFiles(network).search(roots, query, 50, true));
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
