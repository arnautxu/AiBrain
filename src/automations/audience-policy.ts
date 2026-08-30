import type { WorkspaceGroup } from "@/admin/contracts";
import type { LocalUser } from "@/auth/local-user-store";
import type { AutomationAudience } from "@/automations/contracts";

export function invalidAutomationAudienceTargets(
  audience: AutomationAudience,
  users: readonly LocalUser[],
  groups: readonly WorkspaceGroup[],
) {
  const enabledUserIds = new Set(users.filter(({ enabled }) => enabled).map(({ userId }) => userId));
  const groupIds = new Set(groups.map(({ id }) => id));
  return {
    userIds: audience.userIds.filter((id) => !enabledUserIds.has(id)),
    groupIds: audience.groupIds.filter((id) => !groupIds.has(id)),
  };
}

/** Resolves selectors against current workspace membership. Direct and group
 * recipients are deduplicated, and disabled/deleted users fail closed. */
export function resolveCurrentAutomationAudience(
  audience: AutomationAudience,
  users: readonly LocalUser[],
  groups: readonly WorkspaceGroup[],
) {
  const enabledUserIds = new Set(users.filter(({ enabled }) => enabled).map(({ userId }) => userId));
  const recipients = new Set(audience.userIds.filter((id) => enabledUserIds.has(id)));
  const selectedGroups = new Set(audience.groupIds);
  for (const group of groups) {
    if (!selectedGroups.has(group.id)) continue;
    for (const memberId of group.memberIds) {
      if (enabledUserIds.has(memberId)) recipients.add(memberId);
    }
  }
  return recipients;
}
