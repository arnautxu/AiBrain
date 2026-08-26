import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getSigningSecret } from "@/auth/session";

const THREAD_TOKEN_SECONDS = 60 * 60 * 24 * 30;

type ThreadPayload = {
  version: 1;
  tenantId: string;
  threadId: string;
  expiresAt: number;
};

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

export function issueThreadToken(tenantId: string, threadId: string) {
  const payload: ThreadPayload = {
    version: 1,
    tenantId,
    threadId,
    expiresAt: Date.now() + THREAD_TOKEN_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function readThreadToken(token: string, tenantId: string) {
  const [encoded, receivedSignature, extra] = token.split(".");
  if (!encoded || !receivedSignature || extra || !matches(receivedSignature, signature(encoded))) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") return null;
    if (!("version" in value) || value.version !== 1) return null;
    if (!("tenantId" in value) || value.tenantId !== tenantId) return null;
    if (!("threadId" in value) || typeof value.threadId !== "string") return null;
    if (!("expiresAt" in value) || typeof value.expiresAt !== "number" || value.expiresAt <= Date.now()) return null;
    return value.threadId;
  } catch {
    return null;
  }
}
