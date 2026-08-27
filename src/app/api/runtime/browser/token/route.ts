import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/auth/request-security";
import { parseBrowserGatewayTokenRequest } from "@/runtime/browser/http-contract";
import { browserAuthError, browserRuntimeError } from "@/runtime/browser/http-response";
import { getLocalBrowserRequestAuth } from "@/runtime/browser/route-security";
import { issueBrowserGatewayToken } from "@/runtime/browser/server-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const auth = await getLocalBrowserRequestAuth();
  if ("error" in auth) return browserAuthError(auth.error);
  const body: unknown = await request.json().catch(() => null);
  const parsed = parseBrowserGatewayTokenRequest(body);
  if (!parsed) {
    return NextResponse.json({ error: "Les capacitats del visor no són vàlides." }, { status: 400 });
  }
  try {
    const issued = await issueBrowserGatewayToken({
      installationId: auth.session.tenant.id,
      userId: auth.session.user.id,
      authSessionId: auth.authSessionId,
      capabilities: parsed.capabilities,
      ttlMs: parsed.ttlMs,
    });
    return NextResponse.json(issued, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return browserRuntimeError(error, "No s’ha pogut obrir una sessió privada del visor.");
  }
}
