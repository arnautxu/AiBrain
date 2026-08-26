import "server-only";

import type { AuthSession } from "@/auth/types";
import { automationCatalog } from "@/automations/registry";
import type { AutomationDefinition } from "@/lib/automation-contract";

function catalogIds() {
  return new Set<AutomationDefinition["id"]>(automationCatalog.map((item) => item.id));
}

export async function availableAutomations(session: AuthSession) {
  // Scheduled automation configuration is outside V1. Local employees use
  // server-resolved PERMISSIONS.md; until the manual automation adapter is
  // connected to it, fail closed instead of consulting product data remotely.
  if (session.provider === "local") return [];
  return session.provider === "demo" && session.user.role === "owner"
    ? automationCatalog
    : [];
}

export async function canExecuteAutomation(
  session: AuthSession,
  automationId: AutomationDefinition["id"],
) {
  if (!catalogIds().has(automationId)) return false;
  return (await availableAutomations(session)).some((item) => item.id === automationId);
}
