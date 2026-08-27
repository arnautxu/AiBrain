import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { advancedArtifactLibraryItem, buildLibraryItems, type LibraryItemType } from "@/library/contracts";
import { advancedArtifactStoreForSession } from "@/artifacts/server-service";
import { loadWorkbench } from "@/workbench/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const types = new Set<LibraryItemType>(["upload", "image", "document", "result", "browser", "visualization", "internal-site"]);

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
    const snapshot = await loadWorkbench(session);
    let items = buildLibraryItems(snapshot);
    try {
      const projectNames = new Map(snapshot.projects.map((project) => [project.id, project.name]));
      const threadTitles = new Map(snapshot.threads.map((thread) => [thread.id, thread.title]));
      const store = await advancedArtifactStoreForSession(session);
      const advanced = (await store.list(session.user.id)).flatMap((artifact) => {
        const projectName = projectNames.get(artifact.projectId);
        const threadTitle = threadTitles.get(artifact.threadId);
        return projectName && threadTitle ? [advancedArtifactLibraryItem(artifact, { projectName, threadTitle })] : [];
      });
      items = [...advanced, ...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch {
      // The core library remains available if the optional advanced-artifact index is unavailable.
    }
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
