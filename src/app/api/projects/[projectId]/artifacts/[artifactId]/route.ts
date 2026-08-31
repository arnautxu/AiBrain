import { createHash } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { readRegularFileWithin } from "@/security/safe-file";
import { isUuid } from "@/workbench/types";
import { deriveWorkerRoots, resolveWorkerOwnedPath } from "@/runtime/workers/provisioner";
import { contentDisposition, libraryResourceErrorResponse } from "@/library/http";
import { resolveProjectLibraryResource } from "@/library/server-resource-access";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; artifactId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const { projectId, artifactId } = await context.params;
  if (!isUuid(projectId) || !isUuid(artifactId)) {
    return NextResponse.json({ error: "Artefacte no vàlid." }, { status: 400 });
  }
  const searchParams = new URL(request.url).searchParams;
  if ([...searchParams.keys()].some((key) => key !== "download") ||
      searchParams.getAll("download").length > 1 ||
      (searchParams.has("download") && searchParams.get("download") !== "1")) {
    return NextResponse.json({ error: "Consulta no vàlida." }, { status: 400 });
  }
  try {
    const resource = await resolveProjectLibraryResource(session, {
      kind: "generated-image",
      resourceId: artifactId,
      projectId,
    });
    const roots = deriveWorkerRoots(resource.installation, resource.location.storageOwnerId);
    const projectWorkspace = await resolveWorkerOwnedPath(
      roots.workspace,
      path.posix.join("projects", resource.access.project.id),
    );
    const expectedPath = `.aibrain/artifacts/${artifactId}.png`;
    if (resource.location.relativePath !== expectedPath || resource.location.mediaType !== "image/png") {
      return NextResponse.json({ error: "Artefacte no trobat." }, { status: 404 });
    }
    const contents = await readRegularFileWithin(projectWorkspace, expectedPath, 20_000_000);
    if (contents.byteLength !== resource.location.size ||
        createHash("sha256").update(contents).digest("hex") !== resource.location.sha256) {
      return NextResponse.json({ error: "El artefacto ya no coincide con su registro." }, { status: 409 });
    }
    const fileName = resource.location.fileName;
    return new Response(contents, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDisposition(
          fileName,
          searchParams.get("download") === "1" ? "attachment" : "inline",
        ),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const resourceError = libraryResourceErrorResponse(error, "Artefacte no trobat.");
    if (resourceError) return resourceError;
    return NextResponse.json({ error: "Artefacte no trobat." }, { status: 404 });
  }
}
