import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { readRuntimeConfig } from "@/runtime/config";
import { getProjectRuntimeContext } from "@/workbench/store";
import { isUuid } from "@/workbench/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; artifactId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const { projectId, artifactId } = await context.params;
  if (!isUuid(projectId) || !isUuid(artifactId)) {
    return NextResponse.json({ error: "Artefacte no vàlid." }, { status: 400 });
  }
  try {
    const project = await getProjectRuntimeContext(session, projectId);
    const config = readRuntimeConfig(session.tenant.id, project.workspaceKey);
    const contents = await readFile(path.join(config.workspace, ".aibrain", "artifacts", `${artifactId}.png`));
    return new Response(contents, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="imatge-${artifactId.slice(0, 8)}.png"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Artefacte no trobat." }, { status: 404 });
  }
}
