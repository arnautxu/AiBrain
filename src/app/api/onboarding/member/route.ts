import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/auth/request-security";
import { getSession } from "@/auth/session";
import {
  isMemberLanguage,
  isMemberResponseStyle,
} from "@/onboarding/types";
import { completeMemberOnboarding } from "@/onboarding/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  if (session.user.role !== "member") {
    return NextResponse.json({ error: "Aquest flux és només per a membres." }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Petició no vàlida." }, { status: 400 });
  }
  const language = "language" in body ? body.language : null;
  const responseStyle = "responseStyle" in body ? body.responseStyle : null;
  const responsibilityFeedback = "responsibilityFeedback" in body &&
    typeof body.responsibilityFeedback === "string"
    ? body.responsibilityFeedback.trim()
    : "";
  if (!isMemberLanguage(language) || !isMemberResponseStyle(responseStyle) ||
    responsibilityFeedback.length > 500) {
    return NextResponse.json({ error: "Preferències no vàlides." }, { status: 400 });
  }

  const completed = await completeMemberOnboarding(session, {
    language,
    responseStyle,
    responsibilityFeedback,
  });
  if (!completed) {
    return NextResponse.json(
      { error: "No s’ha pogut completar l’onboarding. Revisa que l’admin hagi definit el teu rol." },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { completed: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
