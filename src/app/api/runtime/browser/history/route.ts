import { NextResponse } from "next/server";
import { browserAuthError, browserRuntimeError } from "@/runtime/browser/http-response";
import { getLocalBrowserRequestAuth } from "@/runtime/browser/route-security";
import { browserActionHistory } from "@/runtime/browser/server-service";
import { WorkbenchNotFoundError } from "@/workbench/errors";
import { getThreadRuntimeContext } from "@/workbench/store";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export async function GET(request: Request) {
  const auth = await getLocalBrowserRequestAuth();
  if ("error" in auth) return browserAuthError(auth.error);
  const search = new URL(request.url).searchParams;
  const threadId = search.get("threadId");
  const limitText = search.get("limit");
  const limit = limitText === null ? 50 : Number(limitText);
  if ([...search.keys()].some((key) => key !== "threadId" && key !== "limit") ||
      search.getAll("threadId").length !== 1 || search.getAll("limit").length > 1 ||
      !threadId || !UUID.test(threadId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    return NextResponse.json({ error: "La consulta de l’historial del navegador no és vàlida." }, { status: 400 });
  }
  try {
    await getThreadRuntimeContext(auth.session, threadId);
    const history = await browserActionHistory(
      auth.session.tenant.id,
      auth.session.user.id,
      threadId,
      limit,
    );
    return NextResponse.json({ history }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkbenchNotFoundError) {
      return NextResponse.json({ error: "Fil no trobat." }, { status: 404 });
    }
    return browserRuntimeError(error, "No s’ha pogut llegir l’historial privat del navegador.");
  }
}
