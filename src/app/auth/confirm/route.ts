import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "@/auth/public-url";
import {
  ACTIVE_TENANT_COOKIE,
  getSession,
  isSupabaseAuthEnabled,
} from "@/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const allowedOtpTypes = new Set<EmailOtpType>([
  "email",
  "invite",
  "magiclink",
  "recovery",
  "signup",
  "email_change",
]);

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function privateRedirect(url: URL) {
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request);
  const errorUrl = new URL("/auth/error", origin);
  if (!isSupabaseAuthEnabled()) return privateRedirect(errorUrl);

  const supabase = await createSupabaseServerClient();
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  let authError = null;

  if (code) {
    ({ error: authError } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && requestedType && allowedOtpTypes.has(requestedType)) {
    ({ error: authError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: requestedType,
    }));
  } else {
    return privateRedirect(errorUrl);
  }

  if (authError) return privateRedirect(errorUrl);
  const session = await getSession();
  if (!session || session.provider !== "supabase") {
    await supabase.auth.signOut();
    return privateRedirect(errorUrl);
  }

  const { error: invitationError } = await supabase.rpc("accept_tenant_invitations");
  if (invitationError) {
    console.warn("AiBrain invitation acceptance audit failed", { code: invitationError.code });
  }

  (await cookies()).set(ACTIVE_TENANT_COOKIE, session.tenant.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    priority: "high",
  });

  return privateRedirect(new URL(safeNext(request.nextUrl.searchParams.get("next")), origin));
}
