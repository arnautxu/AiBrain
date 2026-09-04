import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";
import { createSupportRequest } from "@/support/server-service";
import { parseSupportRequestInput } from "@/support/contracts";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) return NextResponse.json({ error: "Origen no autorizado." }, { status: 403, headers: HEADERS });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401, headers: HEADERS });
  const input = parseSupportRequestInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Revisa el tipo, la descripción y el contexto." }, { status: 400, headers: HEADERS });
  try {
    return NextResponse.json({ schemaVersion: 1, request: await createSupportRequest(session, input) }, { status: 201, headers: HEADERS });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "SUPPORT_UNAVAILABLE";
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se ha podido guardar la solicitud.", code }, { status: code === "SUPPORT_RATE_LIMITED" ? 429 : 503, headers: HEADERS });
  }
}
