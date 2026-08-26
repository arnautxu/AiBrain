import { cookies } from "next/headers";
import type { CreatedLocalSession } from "@/auth/local-session-store";

export const LOCAL_SESSION_COOKIE = "__Host-aibrain-session";
export const LOCAL_AUTH_CHALLENGE_COOKIE = "__Host-aibrain-auth-challenge";

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  priority: "high" as const,
};

export async function setLocalSessionCookie(session: CreatedLocalSession) {
  const now = Date.now();
  (await cookies()).set(LOCAL_SESSION_COOKIE, session.sessionId, {
    ...BASE_COOKIE_OPTIONS,
    expires: new Date(session.record.absoluteExpiresAt),
    maxAge: Math.max(0, Math.floor((session.record.absoluteExpiresAt - now) / 1000)),
  });
}

export async function clearLocalSessionCookie() {
  (await cookies()).set(LOCAL_SESSION_COOKIE, "", {
    ...BASE_COOKIE_OPTIONS,
    expires: new Date(0),
    maxAge: 0,
  });
}

export async function setAuthChallengeCookie(challengeId: string, expiresAt: number) {
  const now = Date.now();
  (await cookies()).set(LOCAL_AUTH_CHALLENGE_COOKIE, challengeId, {
    ...BASE_COOKIE_OPTIONS,
    expires: new Date(expiresAt),
    maxAge: Math.max(0, Math.floor((expiresAt - now) / 1000)),
  });
}

export async function clearAuthChallengeCookie() {
  (await cookies()).set(LOCAL_AUTH_CHALLENGE_COOKIE, "", {
    ...BASE_COOKIE_OPTIONS,
    expires: new Date(0),
    maxAge: 0,
  });
}
