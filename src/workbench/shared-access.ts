import "server-only";

import { readdir } from "node:fs/promises";
import type { AuthSession } from "@/auth/types";
import { FileLocalUserStore, type LocalUser } from "@/auth/local-user-store";
import { loadInstallationConfig } from "@/config/installation";
import { WorkbenchNotFoundError, WorkbenchPersistenceError } from "@/workbench/errors";
import { FileWorkbenchStore } from "@/workbench/filesystem-store";
import type { WorkbenchProject, WorkbenchSnapshot, WorkbenchThread } from "@/workbench/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type SharedAccessRole = "owner" | "editor" | "viewer";

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
  const values = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && UUID.test(entry.name)).map((entry) => store.read(entry.name)));
  return { installation, users: values.filter((user): user is LocalUser => user !== null) };
}

function memberRole(project: WorkbenchProject, email: string): SharedAccessRole | null {
  if (project.sharing.visibility !== "shared") return null;
  const member = project.sharing.members.find((item) => item.email === email.toLocaleLowerCase());
  return member ? member.role === "owner" ? "editor" : member.role : null;
}

export async function resolveProjectAccess(session: AuthSession, projectId: string) {
  const { installation, users: provisioned } = await users(session);
  const store = FileWorkbenchStore.fromInstallation(installation);
  for (const user of provisioned) {
    const snapshot = await store.load(user.userId);
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (!project) continue;
    if (user.userId === session.user.id) return { store, ownerUserId: user.userId, role: "owner" as const, project };
    const role = memberRole(project, session.user.email);
    if (role) return { store, ownerUserId: user.userId, role, project };
  }
  throw new WorkbenchNotFoundError("Projecte no trobat.");
}

export async function resolveThreadAccess(session: AuthSession, threadId: string) {
  const { installation, users: provisioned } = await users(session);
  const store = FileWorkbenchStore.fromInstallation(installation);
  for (const user of provisioned) {
    const snapshot = await store.load(user.userId);
    const thread = snapshot.threads.find((item) => item.id === threadId);
    if (!thread) continue;
    const project = snapshot.projects.find((item) => item.id === thread.projectId);
    if (!project) continue;
    if (user.userId === session.user.id) return { store, ownerUserId: user.userId, role: "owner" as const, project, thread };
    const role = memberRole(project, session.user.email);
    if (role) return { store, ownerUserId: user.userId, role, project, thread };
  }
  throw new WorkbenchNotFoundError("Fil no trobat.");
}

export async function loadSharedWorkbench(session: AuthSession): Promise<WorkbenchSnapshot> {
  const { installation, users: provisioned } = await users(session);
  const store = FileWorkbenchStore.fromInstallation(installation);
  const own = await store.load(session.user.id);
  const projects = [...own.projects];
  const threads = [...own.threads];
  for (const user of provisioned) {
    if (user.userId === session.user.id) continue;
    const snapshot = await store.load(user.userId);
    const sharedIds = new Set(snapshot.projects.filter((project) => memberRole(project, session.user.email)).map(({ id }) => id));
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
