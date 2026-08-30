import { NextResponse } from "next/server";
import { parseBrowserViewerThreadQuery } from "@/runtime/browser/http-contract";
import { browserAuthError, browserRuntimeError } from "@/runtime/browser/http-response";
import {
  getLocalBrowserRequestAuth,
  readBrowserBearerToken,
} from "@/runtime/browser/route-security";
import { browserViewerNavigationState } from "@/runtime/browser/server-service";
import { WorkbenchNotFoundError } from "@/workbench/errors";
import { getThreadRuntimeContext } from "@/workbench/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getLocalBrowserRequestAuth();
  if ("error" in auth) return browserAuthError(auth.error);
  const threadId = parseBrowserViewerThreadQuery(new URL(request.url).searchParams);
  if (!threadId) {
    return NextResponse.json({ error: "El fil del visor no és vàlid." }, { status: 400 });
  }
  const token = readBrowserBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Falta l’autorització privada del visor." }, { status: 401 });
  }
  try {
    await getThreadRuntimeContext(auth.session, threadId);
    const navigation = await browserViewerNavigationState({
      installationId: auth.session.tenant.id,
      userId: auth.session.user.id,
      authSessionId: auth.authSessionId,
      threadId,
      token,
      signal: request.signal,
    });
    return NextResponse.json(navigation, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkbenchNotFoundError) {
      return NextResponse.json({ error: "Fil no trobat." }, { status: 404 });
    }
    return browserRuntimeError(error, "No s’ha pogut llegir la navegació privada.");
  }
}
