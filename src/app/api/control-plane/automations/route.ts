import { NextResponse } from "next/server";
import { automationCatalog } from "@/automations/registry";
import { getSession, isSupabaseAuthEnabled } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";
import { isAutomationId } from "@/lib/automation-contract";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/workbench/types";

export const runtime = "nodejs";

async function requireOwner() {
  const session = await getSession();
  return session?.user.role === "owner" ? session : null;
}

async function tenantRecord(tenantSlug: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (error || !data || typeof data.id !== "number") return null;
  return { admin, tenantId: data.id };
}

export async function GET() {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "No autoritzat." }, { status: 403 });
  if (!isSupabaseAuthEnabled() || !isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "Els permisos d’automatitzacions requereixen Supabase." },
      { status: 503 },
    );
  }

  const tenant = await tenantRecord(session.tenant.id);
  if (!tenant) return NextResponse.json({ error: "Tenant no disponible." }, { status: 404 });
  const { admin, tenantId } = tenant;
  const [membersResult, invitationsResult, settingsResult, permissionsResult] = await Promise.all([
    admin.from("tenant_memberships").select("user_id, role").eq("tenant_id", tenantId).eq("role", "member"),
    admin.from("tenant_invitations").select("invited_user_id, email").eq("tenant_id", tenantId).is("revoked_at", null),
    admin.from("tenant_automation_settings").select("automation_id, enabled").eq("tenant_id", tenantId),
    admin.from("member_automation_permissions").select("user_id, automation_id, enabled").eq("tenant_id", tenantId),
  ]);
  const firstError = [membersResult.error, invitationsResult.error, settingsResult.error, permissionsResult.error].find(Boolean);
  if (firstError) {
    return NextResponse.json(
      { error: "La base de dades d’automatitzacions encara no està preparada." },
      { status: 503 },
    );
  }

  const emailByUser = new Map<string, string>();
  for (const invitation of invitationsResult.data ?? []) {
    if (typeof invitation.invited_user_id === "string" && typeof invitation.email === "string") {
      emailByUser.set(invitation.invited_user_id, invitation.email);
    }
  }
  const enabledByAutomation = new Map<string, boolean>();
  for (const setting of settingsResult.data ?? []) {
    if (typeof setting.automation_id === "string") {
      enabledByAutomation.set(setting.automation_id, setting.enabled === true);
    }
  }

  return NextResponse.json({
    automations: automationCatalog.map((automation) => ({
      ...automation,
      enabled: enabledByAutomation.get(automation.id) === true,
    })),
    members: (membersResult.data ?? []).flatMap((membership) => {
      if (typeof membership.user_id !== "string") return [];
      const email = emailByUser.get(membership.user_id) ?? null;
      return [{
        id: membership.user_id,
        email,
        label: email ?? `Treballador ${membership.user_id.slice(0, 8)}`,
      }];
    }),
    permissions: (permissionsResult.data ?? []).flatMap((permission) =>
      typeof permission.user_id === "string" && isAutomationId(permission.automation_id)
        ? [{
            userId: permission.user_id,
            automationId: permission.automation_id,
            enabled: permission.enabled === true,
          }]
        : [],
    ),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "No autoritzat." }, { status: 403 });
  if (!isSupabaseAuthEnabled() || !isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: "Supabase no està configurat." }, { status: 503 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("automationId" in body) ||
      !isAutomationId(body.automationId) || !("enabled" in body) || typeof body.enabled !== "boolean" ||
      !("scope" in body) || (body.scope !== "tenant" && body.scope !== "member")) {
    return NextResponse.json({ error: "Configuració no vàlida." }, { status: 400 });
  }

  const tenant = await tenantRecord(session.tenant.id);
  if (!tenant) return NextResponse.json({ error: "Tenant no disponible." }, { status: 404 });
  const { admin, tenantId } = tenant;
  const supabase = await createSupabaseServerClient();

  if (body.scope === "tenant") {
    const { error } = await supabase.from("tenant_automation_settings").upsert({
      tenant_id: tenantId,
      automation_id: body.automationId,
      enabled: body.enabled,
      configured_by: session.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,automation_id" });
    if (error) return NextResponse.json({ error: "No s’ha pogut activar l’automatització." }, { status: 403 });
  } else {
    const userId = "userId" in body && typeof body.userId === "string" ? body.userId : "";
    if (!isUuid(userId)) return NextResponse.json({ error: "Treballador no vàlid." }, { status: 400 });
    const [{ data: member }, { data: setting }] = await Promise.all([
      admin.from("tenant_memberships").select("user_id").eq("tenant_id", tenantId).eq("user_id", userId).eq("role", "member").maybeSingle(),
      admin.from("tenant_automation_settings").select("enabled").eq("tenant_id", tenantId).eq("automation_id", body.automationId).maybeSingle(),
    ]);
    if (!member) return NextResponse.json({ error: "El treballador no pertany al tenant." }, { status: 404 });
    if (!setting || setting.enabled !== true) {
      return NextResponse.json({ error: "Activa primer l’automatització per a l’empresa." }, { status: 409 });
    }
    const { error } = await supabase.from("member_automation_permissions").upsert({
      tenant_id: tenantId,
      user_id: userId,
      automation_id: body.automationId,
      enabled: body.enabled,
      configured_by: session.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,user_id,automation_id" });
    if (error) return NextResponse.json({ error: "No s’ha pogut desar el permís." }, { status: 403 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
