import "server-only";

import { readdir } from "node:fs/promises";
import type { WorkspaceAdminState } from "@/admin/contracts";
import { effectiveWorkspacePolicy, FileWorkspaceAdminStore } from "@/admin/workspace-admin-store";
import type { AuthSession } from "@/auth/types";
import { FileLocalUserStore, type LocalUser } from "@/auth/local-user-store";
import type {
  AutomationAudience,
  AutomationAudienceDirectory,
  AutomationTask,
  AutomationTaskInput,
  AutomationTaskPatch,
  AutomationTaskView,
} from "@/automations/contracts";
import { invalidAutomationAudienceTargets, resolveCurrentAutomationAudience } from "@/automations/audience-policy";
import { AutomationStoreError, FileAutomationStore } from "@/automations/store";
import { loadInstallationConfig } from "@/config/installation";
import type { InstallationConfig } from "@/config/installation-schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class AutomationAccessError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "AutomationAccessError";
  }
}

async function localUsers(usersRoot: string) {
  const store = new FileLocalUserStore(usersRoot);
  const entries = await readdir(usersRoot, { withFileTypes: true });
  const values = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && UUID.test(entry.name))
    .map((entry) => store.read(entry.name)));
  return values.filter((user): user is LocalUser => user !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export type AutomationWorkspaceContext = {
  installation: Readonly<InstallationConfig>;
  users: LocalUser[];
  state: WorkspaceAdminState;
};

export async function automationWorkspaceContext(
  installation?: Readonly<InstallationConfig>,
): Promise<AutomationWorkspaceContext> {
  installation ??= await loadInstallationConfig();
  const users = await localUsers(installation.paths.usersRoot);
  const state = await new FileWorkspaceAdminStore(
    installation.installationId,
    installation.paths.dataRoot,
  ).read(users.map(({ userId }) => userId));
  return { installation, users, state };
}

export async function automationWorkspaceForSession(session: AuthSession) {
  if (session.provider !== "local") {
    throw new AutomationAccessError("AUTOMATION_LOCAL_SESSION_REQUIRED", "Las automatizaciones requieren una cuenta local persistente.", 403);
  }
  const workspace = await automationWorkspaceContext();
  if (session.tenant.id !== workspace.installation.installationId) {
    throw new AutomationAccessError("AUTOMATION_TENANT_MISMATCH", "La sesión no pertenece a esta instalación.", 403);
  }
  const principal = workspace.users.find(({ userId }) => userId === session.user.id);
  if (!principal || !principal.enabled || principal.email !== session.user.email.toLocaleLowerCase()) {
    throw new AutomationAccessError("AUTOMATION_MEMBER_NOT_FOUND", "La cuenta no está habilitada en esta instalación.", 403);
  }
  const role = effectiveWorkspacePolicy(workspace.state, principal.userId).role;
  return { ...workspace, principal, isAdmin: role.canManageWorkspace };
}

function storeForOwner(workspace: AutomationWorkspaceContext, ownerUserId: string) {
  return new FileAutomationStore({
    installationId: workspace.installation.installationId,
    userId: ownerUserId,
    usersRoot: workspace.installation.paths.usersRoot,
  });
}

export function validateAutomationAudience(
  audience: AutomationAudience,
  workspace: AutomationWorkspaceContext,
) {
  const invalid = invalidAutomationAudienceTargets(audience, workspace.users, workspace.state.groups);
  if (invalid.userIds.length || invalid.groupIds.length) {
    throw new AutomationAccessError(
      "AUTOMATION_AUDIENCE_INVALID",
      "La audiencia contiene usuarios desactivados o destinatarios ajenos a esta empresa.",
      400,
    );
  }
  return {
    membershipPolicy: "current" as const,
    userIds: [...audience.userIds],
    groupIds: [...audience.groupIds],
  };
}

export function automationTaskAccess(
  task: AutomationTask,
  principalUserId: string,
  workspace: AutomationWorkspaceContext,
  isAdmin: boolean,
) {
  const canViewResults = isAdmin || resolveCurrentAutomationAudience(
    task.audience,
    workspace.users,
    workspace.state.groups,
  ).has(principalUserId);
  return {
    canManage: isAdmin || task.userId === principalUserId,
    canViewResults,
  };
}

async function allTasks(workspace: AutomationWorkspaceContext) {
  return (await Promise.all(workspace.users.map((user) => storeForOwner(workspace, user.userId).list()))).flat();
}

export function visibleAutomationTasks(
  tasks: readonly AutomationTask[],
  principalUserId: string,
  workspace: AutomationWorkspaceContext,
  isAdmin: boolean,
) {
  return tasks.flatMap((task): AutomationTaskView[] => {
    const access = automationTaskAccess(task, principalUserId, workspace, isAdmin);
    return access.canManage || access.canViewResults ? [{ ...task, access }] : [];
  });
}

async function locateTask(workspace: AutomationWorkspaceContext, taskId: string) {
  if (!UUID.test(taskId)) throw new AutomationAccessError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.", 404);
  for (const user of workspace.users) {
    try {
      const store = storeForOwner(workspace, user.userId);
      return { store, task: await store.get(taskId, { includeDeleted: true }) };
    } catch (error) {
      if (error instanceof AutomationStoreError && error.code === "AUTOMATION_NOT_FOUND") continue;
      throw error;
    }
  }
  throw new AutomationAccessError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.", 404);
}

export async function listAutomationTasks(session: AuthSession) {
  const context = await automationWorkspaceForSession(session);
  const tasks = visibleAutomationTasks(await allTasks(context), context.principal.userId, context, context.isAdmin);
  const directory: AutomationAudienceDirectory = {
    membershipPolicy: "current",
    currentUserId: context.principal.userId,
    users: context.users.filter(({ enabled }) => enabled).map(({ userId, displayName }) => ({ id: userId, name: displayName })),
    groups: context.state.groups.map(({ id, name }) => ({ id, name })),
  };
  return { tasks: tasks.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)), directory };
}

export async function createAutomationTask(session: AuthSession, input: AutomationTaskInput, options: { taskId?: string } = {}) {
  const context = await automationWorkspaceForSession(session);
  const audience = validateAutomationAudience(input.audience ?? {
    membershipPolicy: "current",
    userIds: [context.principal.userId],
    groupIds: [],
  }, context);
  const task = await storeForOwner(context, context.principal.userId).create({ ...input, audience }, { id: options.taskId });
  return { ...task, access: { canManage: true, canViewResults: true } } satisfies AutomationTaskView;
}

export async function updateAutomationTask(session: AuthSession, taskId: string, patch: AutomationTaskPatch) {
  const context = await automationWorkspaceForSession(session);
  const located = await locateTask(context, taskId);
  const access = automationTaskAccess(located.task, context.principal.userId, context, context.isAdmin);
  if (!access.canManage || located.task.deletedAt !== null) {
    throw new AutomationAccessError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.", 404);
  }
  const nextPatch = patch.audience
    ? { ...patch, audience: validateAutomationAudience(patch.audience, context) }
    : patch;
  const task = await located.store.update(taskId, nextPatch);
  return { ...task, access: automationTaskAccess(task, context.principal.userId, context, context.isAdmin) } satisfies AutomationTaskView;
}

export async function deleteAutomationTask(session: AuthSession, taskId: string) {
  const context = await automationWorkspaceForSession(session);
  const located = await locateTask(context, taskId);
  const access = automationTaskAccess(located.task, context.principal.userId, context, context.isAdmin);
  if (!access.canManage || located.task.deletedAt !== null) {
    throw new AutomationAccessError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.", 404);
  }
  return located.store.delete(taskId);
}

export async function runAutomationTaskNow(session: AuthSession, taskId: string, clientRequestId: string) {
  const context = await automationWorkspaceForSession(session);
  const located = await locateTask(context, taskId);
  const access = automationTaskAccess(located.task, context.principal.userId, context, context.isAdmin);
  if (!access.canManage || located.task.deletedAt !== null) {
    throw new AutomationAccessError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.", 404);
  }
  const task = await located.store.runNow(taskId, clientRequestId);
  return { ...task, access: automationTaskAccess(task, context.principal.userId, context, context.isAdmin) } satisfies AutomationTaskView;
}

export async function automationRunsForSession(session: AuthSession, taskId: string) {
  const context = await automationWorkspaceForSession(session);
  const located = await locateTask(context, taskId);
  const access = automationTaskAccess(located.task, context.principal.userId, context, context.isAdmin);
  if (!access.canViewResults) {
    throw new AutomationAccessError("AUTOMATION_NOT_FOUND", "Automatización no encontrada.", 404);
  }
  return located.store.listRuns(taskId);
}
