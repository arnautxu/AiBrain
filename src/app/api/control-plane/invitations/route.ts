import { NextResponse } from "next/server";
import { getPublicOrigin } from "@/auth/public-url";
import { isSameOriginMutation } from "@/auth/request-security";
import { getSession, isSupabaseAuthEnabled } from "@/auth/session";
import type { UserRole } from "@/auth/types";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

function isRole(value: unknown): value is UserRole {
  return value === "owner" || value === "member";
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "No tens permisos de propietari." }, { status: 403 });
  }
  if (!isSupabaseAuthEnabled() || !isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "El servei d’invitacions no està configurat." },
      { status: 503 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Petició no vàlida." }, { status: 400 });
  }
  const email = "email" in body && typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  const role = "role" in body ? body.role : null;
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320 || !isRole(role)) {
    return NextResponse.json({ error: "Correu o rol no vàlid." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const redirectTo = `${getPublicOrigin(request)}/auth/confirm?next=%2F`;
  const { data, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });
  let invitedUserId = data.user?.id ?? null;
  let delivery: "email_sent" | "existing_user" = "email_sent";
  if (!invitedUserId) {
    const { data: existingUserId, error: lookupError } = await admin.rpc(
      "find_auth_user_id_by_email",
      { p_email: email },
    );
    if (lookupError || typeof existingUserId !== "string") {
      console.warn("AiBrain Supabase invitation failed", {
        inviteCode: inviteError?.code,
        lookupCode: lookupError?.code,
      });
      return NextResponse.json(
        { error: "No s’ha pogut crear ni localitzar la identitat convidada." },
        { status: 409 },
      );
    }
    invitedUserId = existingUserId;
    delivery = "existing_user";
  }

  const { error: membershipError } = await admin.rpc("record_tenant_invitation", {
    p_tenant_slug: session.tenant.id,
    p_email: email,
    p_invited_user_id: invitedUserId,
    p_role: role,
    p_actor_user_id: session.user.id,
  });
  if (membershipError) {
    console.error("AiBrain invitation membership assignment failed", {
      code: membershipError.code,
    });
    return NextResponse.json(
      { error: "La invitació s’ha creat, però el tenant no s’ha assignat. L’accés continua bloquejat." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { invitation: { email, role, delivery } },
    { status: 201, headers: { "Cache-Control": "private, no-store" } },
  );
}
