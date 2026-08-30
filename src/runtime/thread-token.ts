import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getSigningSecret } from "@/auth/session";

const THREAD_TOKEN_SECONDS = 60 * 60 * 24 * 30;

/**
 * Dynamic tools are fixed when App Server creates a thread.  A resumable
 * thread issued before this revision cannot acquire the automation tools on a
 * later `thread/resume`, so callers can use this marker to re-bootstrap only
 * turns that actually need the current toolset.
 */
export const CURRENT_THREAD_TOOLSET_REVISION = "aibrain-tools-2026-08-31-v1";

type ThreadPayload = {
  version: 3;
  tenantId: string;
  userId: string;
  threadId: string;
  toolsetRevision: string | null;
  expiresAt: number;
};

export type RuntimeThreadTokenContext = {
  threadId: string;
  toolsetRevision: string | null;
};

export function toolsetRevisionForIssuedThreadToken(
  resumedThreadId: string | null,
  resumedThreadToolsetRevision: string | null,
) {
  return resumedThreadId
    ? resumedThreadToolsetRevision
    : CURRENT_THREAD_TOOLSET_REVISION;
}

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function signature(value: string) {
  return createHmac("sha256", getSigningSecret())
    .update(`thread:${value}`)
    .digest("base64url");
}

function matches(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueThreadToken(
  tenantId: string,
  userId: string,
  threadId: string,
  toolsetRevision: string | null = CURRENT_THREAD_TOOLSET_REVISION,
) {
  if (!/^[a-z0-9-]{2,63}$/.test(tenantId) ||
      !USER_ID_PATTERN.test(userId) || !THREAD_ID_PATTERN.test(threadId)) {
    throw new Error("Thread token binding is invalid.");
  }
  const payload: ThreadPayload = {
    version: 3,
    tenantId,
    userId,
    threadId,
    toolsetRevision,
    expiresAt: Date.now() + THREAD_TOKEN_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function readThreadTokenContext(
  token: string,
  tenantId: string,
  userId: string,
): RuntimeThreadTokenContext | null {
  if (token.length > 2_048 || !USER_ID_PATTERN.test(userId)) return null;
  const [encoded, receivedSignature, extra] = token.split(".");
  if (!encoded || !receivedSignature || extra || !matches(receivedSignature, signature(encoded))) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") return null;
    if (!("version" in value) || (value.version !== 2 && value.version !== 3)) return null;
    if (!("tenantId" in value) || value.tenantId !== tenantId) return null;
    if (!("userId" in value) || value.userId !== userId) return null;
    if (!("threadId" in value) || typeof value.threadId !== "string" ||
        !THREAD_ID_PATTERN.test(value.threadId)) return null;
    if (!("expiresAt" in value) || typeof value.expiresAt !== "number" || value.expiresAt <= Date.now()) return null;
    if (value.version === 2) {
      return {
        threadId: value.threadId,
        toolsetRevision: null,
      };
    }
    if (!("toolsetRevision" in value) ||
        (value.toolsetRevision !== null && (
          typeof value.toolsetRevision !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.toolsetRevision)
        ))) return null;
    return { threadId: value.threadId, toolsetRevision: value.toolsetRevision };
  } catch {
    return null;
  }
}

export function readThreadToken(token: string, tenantId: string, userId: string) {
  return readThreadTokenContext(token, tenantId, userId)?.threadId ?? null;
}
