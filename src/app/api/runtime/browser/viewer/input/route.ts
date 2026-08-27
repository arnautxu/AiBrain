import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/auth/request-security";
import { parseBrowserViewerCommand } from "@/runtime/browser/http-contract";
import { browserAuthError, browserRuntimeError } from "@/runtime/browser/http-response";
import {
  getLocalBrowserRequestAuth,
  readBrowserBearerToken,
} from "@/runtime/browser/route-security";
import { sendBrowserViewerCommand } from "@/runtime/browser/server-service";
import { WorkbenchNotFoundError } from "@/workbench/errors";
import { getThreadRuntimeContext } from "@/workbench/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const auth = await getLocalBrowserRequestAuth();
  if ("error" in auth) return browserAuthError(auth.error);
  const token = readBrowserBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Falta l’autorització privada del visor." }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  const command = parseBrowserViewerCommand(body);
  if (!command) {
    return NextResponse.json({ error: "L’entrada del visor no és vàlida." }, { status: 400 });
  }
  try {
    await getThreadRuntimeContext(auth.session, command.threadId);
    await sendBrowserViewerCommand({
      installationId: auth.session.tenant.id,
      userId: auth.session.user.id,
      authSessionId: auth.authSessionId,
      threadId: command.threadId,
      token,
      command,
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkbenchNotFoundError) {
      return NextResponse.json({ error: "Fil no trobat." }, { status: 404 });
    }
    return browserRuntimeError(error, "No s’ha pogut aplicar l’entrada al navegador.");
  }
}
