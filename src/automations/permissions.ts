import "server-only";

import type { AuthSession } from "@/auth/types";
import { getAuthMode } from "@/auth/session";
import { automationCatalog } from "@/automations/registry";
import type { AutomationDefinition } from "@/lib/automation-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function catalogIds() {
  return new Set<AutomationDefinition["id"]>(automationCatalog.map((item) => item.id));
}

export async function availableAutomations(session: AuthSession) {
  if (getAuthMode() !== "supabase") {
    return session.user.role === "owner" ? automationCatalog : [];
  }

  const supabase = await createSupabaseServerClient();
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", session.tenant.id)
    .maybeSingle();
  if (tenantError || !tenant || typeof tenant.id !== "number") return [];

  const { data: settings, error: settingsError } = await supabase
    .from("tenant_automation_settings")
    .select("automation_id")
    .eq("tenant_id", tenant.id)
    .eq("enabled", true);
  if (settingsError) return [];

  const enabled = new Set(
    (settings ?? []).flatMap((item) =>
      item && typeof item.automation_id === "string" ? [item.automation_id] : [],
    ),
  );
  if (session.user.role === "owner") {
    return automationCatalog.filter((automation) => enabled.has(automation.id));
  }

  const { data: permissions, error: permissionsError } = await supabase
    .from("member_automation_permissions")
    .select("automation_id")
    .eq("tenant_id", tenant.id)
    .eq("user_id", session.user.id)
    .eq("enabled", true);
  if (permissionsError) return [];
  const allowed = new Set(
    (permissions ?? []).flatMap((item) =>
      item && typeof item.automation_id === "string" ? [item.automation_id] : [],
    ),
  );
  return automationCatalog.filter(
    (automation) => enabled.has(automation.id) && allowed.has(automation.id),
  );
}

export async function canExecuteAutomation(
  session: AuthSession,
  automationId: AutomationDefinition["id"],
) {
  if (!catalogIds().has(automationId)) return false;
  return (await availableAutomations(session)).some((item) => item.id === automationId);
}
