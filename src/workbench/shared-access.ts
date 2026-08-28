import "server-only";

import { readdir } from "node:fs/promises";
import type { AuthSession } from "@/auth/types";
import { FileLocalUserStore, type LocalUser } from "@/auth/local-user-store";
import { loadInstallationConfig } from "@/config/installation";
import { WorkbenchNotFoundError, WorkbenchPersistenceError } from "@/workbench/errors";
import { FileWorkbenchStore } from "@/workbench/filesystem-store";
import {
  FileSharedAccessIndex,
  type SharedAccessProvenance,
  type SharedAccessRole as IndexedSharedAccessRole,
} from "@/workbench/shared-access-index";
import type { WorkbenchProject, WorkbenchSnapshot, WorkbenchThread } from "@/workbench/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type SharedAccessRole = "owner" | IndexedSharedAccessRole;

async function installationForSession(session: AuthSession) {
  if (session.provider !== "local") throw new WorkbenchPersistenceError("La compartición requiere una cuenta local.");
  const installation = await loadInstallationConfig();
  if (installation.installationId !== session.tenant.id) throw new WorkbenchPersistenceError("La sesión no pertenece a esta instalación.");
  return installation;
}

async function users(session: AuthSession) {
  const installation = await installationForSession(session);
  const store = new FileLocalUserStore(installation.paths.usersRoot);
  const entries = await readdir(installation.paths.usersRoot, { withFileTypes: true });
  const values = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && UUID.test(entry.name))
    .map((entry) => store.read(entry.name)));
  const provisioned = values.filter((user): user is LocalUser => user !== null);
  const principal = provisioned.find((user) => user.userId === session.user.id);
  if (!principal || !principal.enabled || principal.email !== session.user.email.toLocaleLowerCase()) {
    throw new WorkbenchNotFoundError("Projecte no trobat.");
  }
  return { installation, users: provisioned, principal };
}

function accessIndex(installation: Awaited<ReturnType<typeof loadInstallationConfig>>) {
  return new FileSharedAccessIndex({
    dataRoot: installation.paths.dataRoot,
    installationId: installation.installationId,
  });
}

async function ownAccessContext(session: AuthSession) {
  const context = await users(session);
  const store = FileWorkbenchStore.fromInstallation(context.installation);
  const own = await store.load(context.principal.userId);
  const index = accessIndex(context.installation);
  await index.syncOwnerSnapshot({ owner: context.principal, snapshot: own, users: context.users });
  return { ...context, store, own, index };
}

export async function syncOwnSharedAccess(session: AuthSession) {
  await ownAccessContext(session);
}

/** The caller must already have resolved access to the project. */
export async function syncSharedThreadAccess(
  session: AuthSession,
  ownerUserId: string,
  projectId: string,
  threadId: string,
) {
  const context = await users(session);
  await accessIndex(context.installation).syncThreadFromProject({
    actorUserId: context.principal.userId,
    ownerUserId,
    projectId,
    threadId,
  });
}

export async function resolveProjectAccess(session: AuthSession, projectId: string) {
  const { principal, store, own, index } = await ownAccessContext(session);
  const ownProject = own.projects.find((item) => item.id === projectId);
  if (ownProject) {
    return { store, ownerUserId: principal.userId, role: "owner" as const, project: ownProject, provenance: null };
  }

  // This is deliberately the last operation before touching a foreign store.
  const grant = await index.resolve({ principal, resourceType: "project", resourceId: projectId });
  if (!grant) throw new WorkbenchNotFoundError("Projecte no trobat.");
  const project = await store.getProject(grant.ownerUserId, projectId);
  return {
    store,
    ownerUserId: grant.ownerUserId,
    role: grant.role,
    project,
    provenance: {
      source: "shared-access-index",
      grantFingerprint: grant.grantFingerprint,
      projectUpdatedAt: grant.projectUpdatedAt,
      indexedAt: grant.indexedAt,
    } satisfies SharedAccessProvenance,
  };
}

export async function resolveThreadAccess(session: AuthSession, threadId: string) {
  const { principal, store, own, index } = await ownAccessContext(session);
  const ownThread = own.threads.find((item) => item.id === threadId);
  if (ownThread) {
    const ownProject = own.projects.find((item) => item.id === ownThread.projectId);
    if (ownProject) {
      return { store, ownerUserId: principal.userId, role: "owner" as const, project: ownProject, thread: ownThread, provenance: null };
    }
  }

  // The durable thread grant is resolved before either foreign thread or project is read.
  const grant = await index.resolve({ principal, resourceType: "thread", resourceId: threadId });
  if (!grant) throw new WorkbenchNotFoundError("Fil no trobat.");
  const thread = await store.getThread(grant.ownerUserId, threadId);
  const project = await store.getProject(grant.ownerUserId, grant.projectId);
  return {
    store,
    ownerUserId: grant.ownerUserId,
    role: grant.role,
    project,
    thread,
    provenance: {
      source: "shared-access-index",
      grantFingerprint: grant.grantFingerprint,
      projectUpdatedAt: grant.projectUpdatedAt,
      indexedAt: grant.indexedAt,
    } satisfies SharedAccessProvenance,
  };
}

export async function loadSharedWorkbench(session: AuthSession): Promise<WorkbenchSnapshot> {
  const { principal, store, own, index } = await ownAccessContext(session);
  const grants = await index.listProjectsForPrincipal(principal);
  const projects = [...own.projects];
  const threads = [...own.threads];
  const byOwner = Map.groupBy(grants, (grant) => grant.ownerUserId);
  for (const [ownerUserId, ownerGrants] of byOwner) {
    const snapshot = await store.load(ownerUserId);
    const sharedIds = new Set(ownerGrants.map((grant) => grant.projectId));
    projects.push(...snapshot.projects.filter((project) => sharedIds.has(project.id)));
    threads.push(...snapshot.threads.filter((thread) => sharedIds.has(thread.projectId)));
  }
  return { persistence: "filesystem", projects, threads };
}

export async function normalizeProjectMembers(session: AuthSession, project: WorkbenchProject) {
  const { users: provisioned } = await users(session);
  const byEmail = new Map(provisioned.filter(({ enabled }) => enabled).map((user) => [user.email, user]));
  return {
    ...project.sharing,
    members: project.sharing.members.map((member) => {
      const user = byEmail.get(member.email);
      return user ? { ...member, name: user.displayName, status: "active" as const } : { ...member, status: "invited-local" as const };
    }),
  };
}

export function threadSummary(thread: WorkbenchThread) {
  const { messages, ...summary } = thread;
  return { ...summary, messageCount: messages.length, lastMessageAt: messages.at(-1)?.createdAt ?? null };
}
