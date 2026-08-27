import type { MemoryKind, MemoryStatus } from "@/memory/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  return actual.join("\0") === [...expected].sort().join("\0");
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum
    && !/\p{C}/u.test(value.replace(/[\t\n\r]/gu, ""));
}

export type CreateExplicitMemoryRequest = {
  explicit: true;
  kind: MemoryKind;
  content: string;
  sourceExcerpt: string;
  clientRequestId: string;
};

export function isCreateExplicitMemoryRequest(value: unknown): value is CreateExplicitMemoryRequest {
  if (!isRecord(value) || !hasExactKeys(value, [
    "explicit", "kind", "content", "sourceExcerpt", "clientRequestId",
  ])) return false;
  return value.explicit === true
    && (value.kind === "recollection" || value.kind === "decision")
    && boundedText(value.content, 32_000)
    && boundedText(value.sourceExcerpt, 4_000)
    && typeof value.clientRequestId === "string"
    && UUID_PATTERN.test(value.clientRequestId);
}

export type RevokeExplicitMemoryRequest = {
  explicit: true;
  reason: string;
  clientRequestId: string;
};

export function isRevokeExplicitMemoryRequest(value: unknown): value is RevokeExplicitMemoryRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["explicit", "reason", "clientRequestId"])) {
    return false;
  }
  return value.explicit === true
    && boundedText(value.reason, 2_000)
    && typeof value.clientRequestId === "string"
    && UUID_PATTERN.test(value.clientRequestId);
}

export type MemoryListQuery = {
  status: MemoryStatus | "all";
  kind?: MemoryKind;
  limit: number;
};

export function parseMemoryListQuery(searchParams: URLSearchParams): MemoryListQuery | null {
  if ([...searchParams.keys()].some((key) => key !== "status" && key !== "kind" && key !== "limit")) {
    return null;
  }
  if (["status", "kind", "limit"].some((key) => searchParams.getAll(key).length > 1)) return null;
  const rawStatus = searchParams.get("status");
  const status = rawStatus ?? "active";
  if (status !== "active" && status !== "revoked" && status !== "all") return null;
  const rawKind = searchParams.get("kind");
  if (rawKind !== null && rawKind !== "recollection" && rawKind !== "decision") return null;
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null && !/^[1-9][0-9]{0,2}$/u.test(rawLimit)) return null;
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit > 100) return null;
  return {
    status,
    ...(rawKind === null ? {} : { kind: rawKind }),
    limit,
  };
}
