import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/auth/request-security";
import { createDemoSession, getAuthMode } from "@/auth/session";
import { getPublicOrigin } from "@/auth/public-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const mode = getAuthMode();
  if (mode === "unavailable") {
    return NextResponse.json(
      { error: "El proveïdor d’identitat no està configurat." },
      { status: 503 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Petició no vàlida." }, { status: 400 });
  }

  if (mode === "demo") {
    if (!("userId" in body) || typeof body.userId !== "string") {
      return NextResponse.json({ error: "Usuari demo no vàlid." }, { status: 400 });
    }
    const session = await createDemoSession(body.userId);
    if (!session) {
      return NextResponse.json({ error: "Usuari demo no autoritzat." }, { status: 403 });
    }
    return NextResponse.json({ session });
  }

  const email = "email" in body && typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) {
    return NextResponse.json({ error: "Introdueix un correu vàlid." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const emailRedirectTo = `${getPublicOrigin(request)}/auth/confirm?next=%2F`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
      shouldCreateUser: false,
    },
  });

  if (error) {
    // Keep the response indistinguishable for invited and unknown addresses.
    console.warn("AiBrain passwordless login request failed", { code: error.code });
  }
  return NextResponse.json(
    { sent: true },
    { status: 202, headers: { "Cache-Control": "private, no-store" } },
  );
}
