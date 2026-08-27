import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { buildLibraryItems, type LibraryItemType } from "@/library/contracts";
import { loadWorkbench } from "@/workbench/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const types = new Set<LibraryItemType>(["upload", "image", "document", "result", "browser"]);

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !["type", "projectId", "q"].includes(key)) ||
      ["type", "projectId", "q"].some((key) => params.getAll(key).length > 1)) {
    return NextResponse.json({ error: "Consulta no vàlida." }, { status: 400 });
  }
  const type = params.get("type");
  const projectId = params.get("projectId")?.trim() || null;
  const query = params.get("q")?.trim() || null;
  if ((type && !types.has(type as LibraryItemType)) || (query && (query.length > 100 || /\p{C}/u.test(query)))) {
    return NextResponse.json({ error: "Consulta no vàlida." }, { status: 400 });
  }
  try {
    let items = buildLibraryItems(await loadWorkbench(session));
    if (type) items = items.filter((item) => item.type === type);
    if (projectId) items = items.filter((item) => item.projectId === projectId);
    if (query) {
      const needle = normalized(query);
      items = items.filter((item) => normalized(`${item.name} ${item.projectName} ${item.threadTitle}`).includes(needle));
    }
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "La biblioteca no està disponible." }, { status: 503 });
  }
}
