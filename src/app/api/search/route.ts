import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { buildGlobalSearchResults } from "@/library/contracts";
import { memoryServiceForSession } from "@/memory/server-service";
import type { MemoryRecord } from "@/memory/types";
import { loadWorkbench } from "@/workbench/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "q") || params.getAll("q").length !== 1) {
    return NextResponse.json({ error: "Consulta no vàlida." }, { status: 400 });
  }
  const query = params.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 100 || /\p{C}/u.test(query)) {
    return NextResponse.json({ error: "Escribe al menos dos caracteres." }, { status: 400 });
  }
  try {
    const snapshot = await loadWorkbench(session);
    let memories: MemoryRecord[] = [];
    if (session.provider === "local") {
      try {
        const memory = await memoryServiceForSession(session);
        memories = await memory.service.list(memory.context, { status: "active", limit: 100 });
      } catch {
        // Search remains useful when the optional memory index is temporarily unavailable.
      }
    }
    return NextResponse.json(
      { results: buildGlobalSearchResults(snapshot, query, memories) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "La búsqueda no está disponible." }, { status: 503 });
  }
}
