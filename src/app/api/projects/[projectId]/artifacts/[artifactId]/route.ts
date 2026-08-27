import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { readRegularFileWithin } from "@/security/safe-file";
import { getProjectRuntimeContext } from "@/workbench/store";
import { isUuid } from "@/workbench/types";
import { loadInstallationConfig } from "@/config/installation";
import { deriveWorkerRoots, resolveWorkerOwnedPath } from "@/runtime/workers/provisioner";

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
    const installation = await loadInstallationConfig();
    if (installation.installationId !== session.tenant.id) throw new Error("Installation mismatch.");
    const roots = deriveWorkerRoots(installation, session.user.id);
    const projectWorkspace = await resolveWorkerOwnedPath(
      roots.workspace,
      path.posix.join("projects", project.projectId),
    );
    const artifactRoot = path.join(projectWorkspace, ".aibrain", "artifacts");
    const contents = await readRegularFileWithin(artifactRoot, `${artifactId}.png`, 20_000_000);
    return new Response(contents, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="imatge-${artifactId.slice(0, 8)}.png"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Artefacte no trobat." }, { status: 404 });
  }
}
