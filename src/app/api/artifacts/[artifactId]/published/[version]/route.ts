import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { advancedArtifactErrorResponse } from "@/artifacts/http";
import { ARTIFACT_PREVIEW_CSP } from "@/artifacts/rendering";
import { advancedArtifactStoreForSession } from "@/artifacts/server-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ artifactId: string; version: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const { artifactId, version: rawVersion } = await context.params;
  const version = Number(rawVersion);
  if (!Number.isSafeInteger(version) || version < 1) return NextResponse.json({ error: "Versión no válida." }, { status: 400 });
  try {
    const store = await advancedArtifactStoreForSession(session);
    const { html } = await store.readPublished(session.user.id, artifactId, version);
    return new NextResponse(html, { headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": ARTIFACT_PREVIEW_CSP,
      "Content-Type": "text/html; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return advancedArtifactErrorResponse(error, "No se ha podido abrir el sitio interno.");
  }
}
