import { NextResponse } from "next/server";
import { parseBrowserViewerThreadQuery } from "@/runtime/browser/http-contract";
import { browserAuthError, browserRuntimeError } from "@/runtime/browser/http-response";
import {
  getLocalBrowserRequestAuth,
  readBrowserBearerToken,
} from "@/runtime/browser/route-security";
import { captureBrowserFrame } from "@/runtime/browser/server-service";
import { WorkbenchNotFoundError } from "@/workbench/errors";
import { getThreadRuntimeContext } from "@/workbench/store";

export const runtime = "nodejs";

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
    const frame = await captureBrowserFrame({
      installationId: auth.session.tenant.id,
      userId: auth.session.user.id,
      authSessionId: auth.authSessionId,
      threadId,
      token,
      signal: request.signal,
    });
    return new NextResponse(Buffer.from(frame.dataBase64, "base64"), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": frame.mediaType,
        "X-AiBrain-Captured-At": frame.capturedAt,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof WorkbenchNotFoundError) {
      return NextResponse.json({ error: "Fil no trobat." }, { status: 404 });
    }
    return browserRuntimeError(error, "No s’ha pogut obtenir el frame privat del navegador.");
  }
}
