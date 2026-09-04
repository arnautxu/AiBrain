import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/auth/request-security";
import { parseBrowserControlRequest } from "@/runtime/browser/http-contract";
import { browserAuthError, browserRuntimeError } from "@/runtime/browser/http-response";
import { getLocalBrowserRequestAuth } from "@/runtime/browser/route-security";
import { browserStatus, controlBrowser } from "@/runtime/browser/server-service";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getLocalBrowserRequestAuth();
  if ("error" in auth) return browserAuthError(auth.error);
  try {
    const status = await browserStatus(auth.session.tenant.id, auth.session.user.id);
    return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return browserRuntimeError(error, "No s’ha pogut llegir l’estat del navegador.");
  }
}

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const auth = await getLocalBrowserRequestAuth();
  if ("error" in auth) return browserAuthError(auth.error);
  const body: unknown = await request.json().catch(() => null);
  const parsed = parseBrowserControlRequest(body);
  if (!parsed) {
    return NextResponse.json({ error: "El control del navegador no és vàlid." }, { status: 400 });
  }
  try {
    const result = await controlBrowser(auth.session.tenant.id, auth.session.user.id, parsed.action, parsed.binding);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return browserRuntimeError(error, "No s’ha pogut controlar el navegador de forma segura.");
  }
}
