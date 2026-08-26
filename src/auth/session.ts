import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { AuthMode, AuthSession, UserRole } from "@/auth/types";
import { getDemoAccount, getTenantDefinition } from "@/config/tenants";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const SESSION_COOKIE = "aibrain_session";
export const ACTIVE_TENANT_COOKIE = "aibrain_tenant";
const SESSION_SECONDS = 60 * 60 * 12;
const DEVELOPMENT_SECRET = "aibrain-local-demo-session-key-v1";

type SessionPayload = {
  version: 1;
  userId: string;
  tenantId: string;
  issuedAt: number;
  expiresAt: number;
};

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function isVercelPreviewDemoEnabled() {
  return process.env.VERCEL_ENV === "preview" &&
    process.env.AIBRAIN_AUTH_MODE === "demo" &&
    process.env.AIBRAIN_ENABLE_PREVIEW_DEMO === "1";
}

export function getAuthMode(): AuthMode {
  const configured = process.env.AIBRAIN_AUTH_MODE?.trim();
  if (configured === "supabase") {
    return readSupabasePublicConfig() ? "supabase" : "unavailable";
  }
  if (isVercelPreviewDemoEnabled()) return "demo";
  if ((configured === "demo" || !configured) && process.env.NODE_ENV !== "production") {
    return "demo";
  }
  return "unavailable";
}

export function isDemoAuthEnabled() {
  return getAuthMode() === "demo";
}

export function isSupabaseAuthEnabled() {
  return getAuthMode() === "supabase";
}

export function getSigningSecret() {
  const configured = process.env.AIBRAIN_SESSION_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return DEVELOPMENT_SECRET;
  throw new Error("AIBRAIN_SESSION_SECRET és obligatori en un entorn real.");
}

function sign(value: string) {
  return createHmac("sha256", getSigningSecret()).update(value).digest("base64url");
}

function signaturesMatch(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer);
}

function parsePayload(token: string): SessionPayload | null {
  const [encodedPayload, receivedSignature, extra] = token.split(".");
  if (!encodedPayload || !receivedSignature || extra) return null;
  if (!signaturesMatch(receivedSignature, sign(encodedPayload))) return null;

  try {
    const payload: unknown = JSON.parse(decode(encodedPayload));
    if (!payload || typeof payload !== "object") return null;
    if (!("version" in payload) || payload.version !== 1) return null;
    if (!("userId" in payload) || typeof payload.userId !== "string") return null;
    if (!("tenantId" in payload) || typeof payload.tenantId !== "string") return null;
    if (!("issuedAt" in payload) || typeof payload.issuedAt !== "number") return null;
    if (!("expiresAt" in payload) || typeof payload.expiresAt !== "number") return null;
    if (payload.expiresAt <= Date.now()) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

function toSession(payload: SessionPayload): AuthSession | null {
  const account = getDemoAccount(payload.userId);
  const tenant = getTenantDefinition(payload.tenantId);
  if (!account || !tenant || account.tenantId !== tenant.id) return null;

  return {
    provider: "demo",
    user: {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
    },
    tenant: { id: tenant.id, name: tenant.name },
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };
}

export async function getSession(): Promise<AuthSession | null> {
  const mode = getAuthMode();
  if (mode === "supabase") return getSupabaseSession();
  if (mode !== "demo") return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = parsePayload(token);
  return payload ? toSession(payload) : null;
}

export async function createDemoSession(userId: string) {
  if (!isDemoAuthEnabled()) return null;
  const account = getDemoAccount(userId);
  if (!account) return null;
  const now = Date.now();
  const payload: SessionPayload = {
    version: 1,
    userId: account.id,
    tenantId: account.tenantId,
    issuedAt: now,
    expiresAt: now + SESSION_SECONDS * 1000,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  const token = `${encodedPayload}.${sign(encodedPayload)}`;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
    priority: "high",
  });
  return toSession(payload);
}

export async function deleteSession() {
  if (isSupabaseAuthEnabled()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(ACTIVE_TENANT_COOKIE);
}

function isRole(value: unknown): value is UserRole {
  return value === "owner" || value === "member";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function displayName(claims: Record<string, unknown>, email: string) {
  const metadata = asRecord(claims.user_metadata);
  const configured = metadata?.full_name ?? metadata?.name;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  return email.split("@")[0] || "Usuari";
}

function parseMembership(value: unknown) {
  const membership = asRecord(value);
  if (!membership || !isRole(membership.role)) return null;
  const rawTenant = Array.isArray(membership.tenant) ? membership.tenant[0] : membership.tenant;
  const tenant = asRecord(rawTenant);
  if (!tenant || typeof tenant.slug !== "string" || typeof tenant.name !== "string") return null;
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenant.slug)) return null;
  return {
    role: membership.role,
    tenant: { id: tenant.slug, name: tenant.name },
  };
}

async function getSupabaseSession(): Promise<AuthSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data: claimsResult, error: claimsError } = await supabase.auth.getClaims();
  const claims = asRecord(claimsResult?.claims);
  if (claimsError || !claims || typeof claims.sub !== "string" ||
    typeof claims.email !== "string" || typeof claims.exp !== "number") {
    return null;
  }

  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("role, created_at, tenant:tenants!tenant_memberships_tenant_id_fkey(id, slug, name)")
    .eq("user_id", claims.sub)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("AiBrain membership lookup failed", { code: error.code });
    return null;
  }

  const memberships = Array.isArray(data) ? data.map(parseMembership).filter(Boolean) : [];
  if (!memberships.length) return null;
  const preferredTenant = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  const membership = memberships.find((candidate) => candidate?.tenant.id === preferredTenant) ??
    memberships[0];
  if (!membership) return null;

  return {
    provider: "supabase",
    user: {
      id: claims.sub,
      name: displayName(claims, claims.email),
      email: claims.email,
      role: membership.role,
    },
    tenant: membership.tenant,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}
