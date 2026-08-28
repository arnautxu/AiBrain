import "server-only";

import type { AuthSession } from "@/auth/types";
import { loadInstallationConfig } from "@/config/installation";
import {
  DEFAULT_TASK_NOTIFICATION_PREFERENCES,
  deriveTaskCenterItems,
  type TaskCenterPayload,
  type TaskNotificationPreferences,
} from "@/task-center/contracts";
import { FileTaskCenterStore } from "@/task-center/file-store";
import { WorkbenchPersistenceError } from "@/workbench/errors";
import { loadWorkbench } from "@/workbench/store";

async function localStore(session: AuthSession) {
  const installation = await loadInstallationConfig();
  if (session.provider !== "local" || session.tenant.id !== installation.installationId) {
    throw new WorkbenchPersistenceError("La sesión no pertenece a esta instalación.");
  }
  return FileTaskCenterStore.fromInstallation(installation);
}

export async function getTaskCenter(session: AuthSession): Promise<TaskCenterPayload> {
  const workbench = await loadWorkbench(session);
  const state = session.provider === "local"
    ? await (await localStore(session)).load(session.user.id)
    : { readTaskIds: [], preferences: DEFAULT_TASK_NOTIFICATION_PREFERENCES };
  return {
    tasks: deriveTaskCenterItems(workbench, state.readTaskIds),
    readTaskIds: state.readTaskIds,
    preferences: state.preferences,
    continuity: "worker_required",
  };
}

export async function updateTaskCenter(
  session: AuthSession,
  update: { markRead?: string[]; preferences?: TaskNotificationPreferences },
): Promise<TaskCenterPayload> {
  const workbench = await loadWorkbench(session);
  const state = session.provider === "local"
    ? await (await localStore(session)).update(session.user.id, update)
    : {
        readTaskIds: update.markRead ?? [],
        preferences: update.preferences ?? DEFAULT_TASK_NOTIFICATION_PREFERENCES,
      };
  return {
    tasks: deriveTaskCenterItems(workbench, state.readTaskIds),
    readTaskIds: state.readTaskIds,
    preferences: state.preferences,
    continuity: "worker_required",
  };
}
