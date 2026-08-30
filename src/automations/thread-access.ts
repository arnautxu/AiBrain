import "server-only";

import type { AuthSession } from "@/auth/types";
import { FileAutomationAudienceStore, type AutomationThreadDelivery } from "@/automations/audience-store";
import { automationTaskAccess, automationWorkspaceForSession } from "@/automations/server-service";
import { AutomationStoreError, FileAutomationStore } from "@/automations/store";
import { loadInstallationConfig } from "@/config/installation";
import type { AutomationTask } from "@/automations/contracts";

async function audienceStoreForSession(session: AuthSession) {
  const installation = await loadInstallationConfig();
  if (session.provider !== "local" || session.tenant.id !== installation.installationId) return null;
  return new FileAutomationAudienceStore({
    installationId: installation.installationId,
    dataRoot: installation.paths.dataRoot,
  });
}

function authorizeTaskDelivery(
  delivery: AutomationThreadDelivery,
  task: AutomationTask,
  context: Awaited<ReturnType<typeof automationWorkspaceForSession>>,
) {
  if (task.id !== delivery.taskId || task.userId !== delivery.ownerUserId || task.projectId !== delivery.projectId ||
    task.installationId !== context.installation.installationId) return null;
  const access = automationTaskAccess(task, context.principal.userId, context, context.isAdmin);
  return access.canViewResults ? { delivery, task } : null;
}

async function authorizedDelivery(
  delivery: AutomationThreadDelivery,
  context: Awaited<ReturnType<typeof automationWorkspaceForSession>>,
) {
  if (!context.users.some(({ userId }) => userId === delivery.ownerUserId)) return null;
  const store = new FileAutomationStore({
    installationId: context.installation.installationId,
    userId: delivery.ownerUserId,
    usersRoot: context.installation.paths.usersRoot,
  });
  try {
    const task = await store.get(delivery.taskId, { includeDeleted: true });
    return authorizeTaskDelivery(delivery, task, context);
  } catch (error) {
    if (error instanceof AutomationStoreError && error.code === "AUTOMATION_NOT_FOUND") return null;
    throw error;
  }
}

export async function resolveAutomationThreadAccess(session: AuthSession, threadId: string) {
  const audienceStore = await audienceStoreForSession(session);
  if (!audienceStore) return null;
  const delivery = await audienceStore.findByThread(threadId);
  if (!delivery) return null;
  const context = await automationWorkspaceForSession(session);
  const authorized = await authorizedDelivery(delivery, context);
  return authorized ? { ...authorized, context } : null;
}

export async function listAutomationThreadAccess(session: AuthSession) {
  const audienceStore = await audienceStoreForSession(session);
  if (!audienceStore) return [];
  const deliveries = await audienceStore.list();
  if (deliveries.length === 0) return [];
  const context = await automationWorkspaceForSession(session);
  const knownUserIds = new Set(context.users.map(({ userId }) => userId));
  const byOwner = Map.groupBy(deliveries.filter(({ ownerUserId }) => knownUserIds.has(ownerUserId)), ({ ownerUserId }) => ownerUserId);
  const authorized = await Promise.all([...byOwner].map(async ([ownerUserId, ownerDeliveries]) => {
    const tasks = await new FileAutomationStore({
      installationId: context.installation.installationId,
      userId: ownerUserId,
      usersRoot: context.installation.paths.usersRoot,
    }).list({ includeDeleted: true });
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    return ownerDeliveries.flatMap((delivery) => {
      const task = tasksById.get(delivery.taskId);
      const value = task ? authorizeTaskDelivery(delivery, task, context) : null;
      return value ? [value] : [];
    });
  }));
  return authorized.flat();
}
