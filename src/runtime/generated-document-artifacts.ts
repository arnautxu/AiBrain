import { createHash } from "node:crypto";
import path from "node:path";
import type { DocumentArtifact } from "@/lib/chat-contract";
import { readRegularFileWithin } from "@/security/safe-file";

const MAXIMUM_DOCUMENT_BYTES = 50 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function documentArtifactId(turnId: string, relativePath: string) {
  const digest = createHash("sha256").update(`${turnId}\0${relativePath}`).digest("hex").slice(0, 32).split("");
  digest[12] = "4";
  digest[16] = "8";
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pathsInText(value: unknown) {
  if (typeof value !== "string") return [];
  const paths: string[] = [];
  const expression = /(?:"([^"\n\r]+\.pdf)"|'([^'\n\r]+\.pdf)'|((?:\/|\.{1,2}\/)[^\s"'<>|]+\.pdf))/giu;
  for (const match of value.matchAll(expression)) {
    const candidate = match[1] ?? match[2] ?? match[3];
    if (candidate) paths.push(candidate);
  }
  return paths;
}

function runtimePdfPaths(item: Record<string, unknown>) {
  const candidates = [
    ...pathsInText(item.command),
    ...pathsInText(item.aggregatedOutput),
    ...pathsInText(item.text),
  ];
  if (Array.isArray(item.changes)) {
    for (const change of item.changes) {
      if (!isRecord(change)) continue;
      const candidate = typeof change.path === "string"
        ? change.path
        : typeof change.filePath === "string" ? change.filePath : null;
      if (candidate?.toLocaleLowerCase().endsWith(".pdf")) candidates.push(candidate);
    }
  }
  return [...new Set(candidates)];
}

function pageCount(item: Record<string, unknown>) {
  const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
  const match = output.match(/^Pages:\s+(\d+)\s*$/imu);
  if (!match) return null;
  const pages = Number(match[1]);
  return Number.isSafeInteger(pages) && pages >= 1 && pages <= 500 ? pages : null;
}

export async function generatedDocumentArtifactsFromRuntimeItem(
  value: unknown,
  projectWorkspace: string,
  projectId: string,
  turnId: string,
): Promise<DocumentArtifact[]> {
  if (!isRecord(value)) return [];
  const pages = pageCount(value);
  const artifacts: DocumentArtifact[] = [];

  for (const candidate of runtimePdfPaths(value)) {
    const relativePath = path.isAbsolute(candidate)
      ? path.relative(projectWorkspace, candidate)
      : path.normalize(candidate);
    if (!relativePath || relativePath === "." || path.isAbsolute(relativePath) ||
        relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) continue;

    try {
      const contents = await readRegularFileWithin(projectWorkspace, relativePath, MAXIMUM_DOCUMENT_BYTES);
      if (contents.length < 5 || contents.subarray(0, 5).toString("ascii") !== "%PDF-") continue;
      const encodedPath = encodeURIComponent(relativePath.split(path.sep).join("/"));
      const fileRoute = `/api/projects/${projectId}/files?path=${encodedPath}&raw=1`;
      artifacts.push({
        id: documentArtifactId(turnId, relativePath),
        type: "document",
        name: path.basename(relativePath),
        url: `${fileRoute}&download=1`,
        kind: "pdf",
        mimeType: "application/pdf",
        size: contents.length,
        status: "ready",
        pages,
        previewUrl: fileRoute,
        publicationStatus: null,
        publicationError: null,
        targetLabel: null,
        error: null,
      });
    } catch {
      // Runtime text is untrusted; inaccessible or out-of-workspace paths are ignored.
    }
  }
  return artifacts;
}
