import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { loadInstallationConfig } from "@/config/installation";
import { contentDisposition } from "@/library/http";
import { deriveWorkerRoots, resolveWorkerOwnedPath } from "@/runtime/workers/provisioner";
import { readRegularFileWithin } from "@/security/safe-file";
import { getProjectRuntimeContext } from "@/workbench/store";
import { isUuid } from "@/workbench/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_TEXT_FILE_BYTES = 8_000_000;
const MAXIMUM_BINARY_FILE_BYTES = 50 * 1024 * 1024;
const MAXIMUM_TEXT_BYTES = 500_000;
const PDF_SIGNATURE = Buffer.from("%PDF-");

const imageMimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const textLanguages: Record<string, string> = {
  ".css": "CSS",
  ".go": "Go",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JSX",
  ".json": "JSON",
  ".kt": "Kotlin",
  ".md": "Markdown",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scss": "SCSS",
  ".sh": "Shell",
  ".sql": "SQL",
  ".swift": "Swift",
  ".toml": "TOML",
  ".ts": "TypeScript",
  ".tsx": "TSX",
  ".txt": "Texto",
  ".xml": "XML",
  ".yaml": "YAML",
  ".yml": "YAML",
};

function previewType(filePath: string) {
  const extension = path.extname(filePath).toLocaleLowerCase();
  const imageMimeType = imageMimeTypes[extension];
  if (imageMimeType) return { kind: "image" as const, mimeType: imageMimeType, language: null };
  if (extension === ".pdf") return { kind: "pdf" as const, mimeType: "application/pdf", language: null };
  return {
    kind: "text" as const,
    mimeType: extension === ".json" ? "application/json" : "text/plain",
    language: textLanguages[extension] ?? "Texto",
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  const { projectId } = await context.params;
  if (!isUuid(projectId)) return NextResponse.json({ error: "Proyecto no válido." }, { status: 400 });

  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");
  const raw = url.searchParams.get("raw") === "1";
  const download = url.searchParams.get("download") === "1";
  if (
    [...url.searchParams.keys()].some((key) => key !== "path" && key !== "raw" && key !== "download") ||
    url.searchParams.getAll("path").length !== 1 ||
    url.searchParams.getAll("raw").length > 1 ||
    url.searchParams.getAll("download").length > 1 ||
    (url.searchParams.has("raw") && url.searchParams.get("raw") !== "1") ||
    (url.searchParams.has("download") && url.searchParams.get("download") !== "1") ||
    (download && !raw) ||
    !filePath || filePath.length > 2_048 || filePath.includes("\0")
  ) {
    return NextResponse.json({ error: "Ruta no válida." }, { status: 400 });
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
    const workspaceRelativePath = path.isAbsolute(filePath)
      ? path.relative(projectWorkspace, filePath)
      : filePath;
    const preview = previewType(filePath);
    const contents = await readRegularFileWithin(
      projectWorkspace,
      workspaceRelativePath,
      preview.kind === "text" ? MAXIMUM_TEXT_FILE_BYTES : MAXIMUM_BINARY_FILE_BYTES,
    );

    if (raw) {
      if (preview.kind === "text") {
        return NextResponse.json({ error: "Este archivo se muestra como texto." }, { status: 400 });
      }
      if (preview.kind === "pdf" && !contents.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
        return NextResponse.json({ error: "El archivo no es un PDF válido." }, { status: 415 });
      }
      return new Response(contents, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": contentDisposition(path.basename(filePath), download ? "attachment" : "inline"),
          "Content-Type": preview.mimeType,
          ...(download ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'" }),
          "Cross-Origin-Resource-Policy": "same-origin",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          // The authenticated client fetches this response into a blob before
          // previewing it. Keeping the original response non-frameable avoids
          // turning a private document URL into an embeddable resource.
          "X-Frame-Options": "DENY",
        },
      });
    }

    if (preview.kind !== "text") {
      const previewUrl = `/api/projects/${projectId}/files?path=${encodeURIComponent(filePath)}&raw=1`;
      return NextResponse.json({
        file: {
          path: filePath,
          name: path.basename(filePath),
          kind: preview.kind,
          mimeType: preview.mimeType,
          size: contents.length,
          language: null,
          content: null,
          previewUrl,
        },
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    if (contents.length > MAXIMUM_TEXT_BYTES) {
      return NextResponse.json({ error: "El archivo es demasiado grande para mostrarlo dentro del chat." }, { status: 413 });
    }
    if (contents.includes(0)) {
      return NextResponse.json({ error: "Este formato no admite una vista previa segura." }, { status: 415 });
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    } catch {
      return NextResponse.json({ error: "Este formato no admite una vista previa segura." }, { status: 415 });
    }
    return NextResponse.json({
      file: {
        path: filePath,
        name: path.basename(filePath),
        kind: preview.kind,
        mimeType: preview.mimeType,
        size: contents.length,
        language: preview.language,
        content,
        previewUrl: null,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No se ha podido abrir este archivo del proyecto." }, { status: 404 });
  }
}
