import { NextResponse } from "next/server";
import { browserAuthError, browserRuntimeError } from "@/runtime/browser/http-response";
import {
  getLocalBrowserRequestAuth,
  readBrowserBearerToken,
} from "@/runtime/browser/route-security";
import { captureBrowserFrame } from "@/runtime/browser/server-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await getLocalBrowserRequestAuth();
  if ("error" in auth) return browserAuthError(auth.error);
  const token = readBrowserBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Falta l’autorització privada del visor." }, { status: 401 });
  }
  try {
    const frame = await captureBrowserFrame({
      installationId: auth.session.tenant.id,
      userId: auth.session.user.id,
      authSessionId: auth.authSessionId,
      token,
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
    return browserRuntimeError(error, "No s’ha pogut obtenir el frame privat del navegador.");
  }
}
