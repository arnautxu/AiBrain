import { NextResponse } from "next/server";
import { parseBrowserViewerThreadQuery } from "@/runtime/browser/http-contract";
import { browserAuthError, browserRuntimeError } from "@/runtime/browser/http-response";
import {
  getLocalBrowserRequestAuth,
  readBrowserBearerToken,
} from "@/runtime/browser/route-security";
import {
  browserViewerNavigationState,
  streamBrowserFrames,
} from "@/runtime/browser/server-service";
import {
  BROWSER_FRAME_STREAM_CONTENT_TYPE,
  encodeBrowserFrameStreamRecord,
} from "@/ui/browser-frame-stream";
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
    const binding = {
      installationId: auth.session.tenant.id,
      userId: auth.session.user.id,
      authSessionId: auth.authSessionId,
      threadId,
      token,
    };
    // Authorize before committing the streaming response status and headers.
    await browserViewerNavigationState({ ...binding, signal: request.signal });
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    const frames = streamBrowserFrames({ ...binding, signal: controller.signal });
    const stream = new ReadableStream<Uint8Array>({
      async pull(destination) {
        try {
          const next = await frames.next();
          if (next.done) {
            destination.close();
            request.signal.removeEventListener("abort", abort);
            return;
          }
          destination.enqueue(encodeBrowserFrameStreamRecord({
            metadata: {
              version: 1,
              kind: next.value.kind,
              sequence: next.value.sequence,
              capturedAt: next.value.capturedAt,
              captureDurationMs: next.value.captureDurationMs,
              mediaType: next.value.mediaType,
            },
            data: next.value.data,
          }));
        } catch (error) {
          destination.error(error);
          request.signal.removeEventListener("abort", abort);
        }
      },
      async cancel() {
        controller.abort();
        request.signal.removeEventListener("abort", abort);
        await frames.return(undefined).catch(() => undefined);
      },
    });
    return new Response(stream, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": BROWSER_FRAME_STREAM_CONTENT_TYPE,
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof WorkbenchNotFoundError) {
      return NextResponse.json({ error: "Fil no trobat." }, { status: 404 });
    }
    return browserRuntimeError(error, "No s’ha pogut obrir el stream privat del navegador.");
  }
}
