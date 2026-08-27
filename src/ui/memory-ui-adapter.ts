import type { MemoryKind, MemoryRecord } from "@/memory/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!isRecord(value) || !isRecord(value.provenance)) return false;
  return value.schemaVersion === 1
    && typeof value.memoryId === "string"
    && typeof value.content === "string"
    && (value.kind === "recollection" || value.kind === "decision")
    && value.explicit === true
    && (value.status === "active" || value.status === "revoked")
    && typeof value.createdAt === "string";
}

async function responseError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) && typeof body.error === "string"
    ? body.error
    : "No se ha podido actualizar la memoria.";
}

export async function listExplicitMemories(signal?: AbortSignal) {
  const response = await fetch("/api/memory?status=all&limit=100", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await responseError(response));
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.memories) || !body.memories.every(isMemoryRecord)) {
    throw new Error("La respuesta de memoria no es válida.");
  }
  return body.memories;
}

export async function createExplicitMemory(input: { kind: MemoryKind; content: string }) {
  const content = input.content.trim();
  const response = await fetch("/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      explicit: true,
      kind: input.kind,
      content,
      sourceExcerpt: content.slice(0, 4_000),
      clientRequestId: crypto.randomUUID(),
    }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const body: unknown = await response.json();
  if (!isRecord(body) || !isMemoryRecord(body.memory)) {
    throw new Error("La memoria guardada no es válida.");
  }
  return body.memory;
}

export async function revokeExplicitMemory(memoryId: string, reason: string) {
  const response = await fetch(`/api/memory/${encodeURIComponent(memoryId)}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      explicit: true,
      reason: reason.trim(),
      clientRequestId: crypto.randomUUID(),
    }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const body: unknown = await response.json();
  if (!isRecord(body) || !isMemoryRecord(body.memory)) {
    throw new Error("La memoria revocada no es válida.");
  }
  return body.memory;
}
