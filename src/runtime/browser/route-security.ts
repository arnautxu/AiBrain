import "server-only";

import { cookies } from "next/headers";
import { getSession } from "@/auth/session";
import { LOCAL_SESSION_COOKIE } from "@/auth/session-cookie";
import type { AuthSession } from "@/auth/types";

export type LocalBrowserRequestAuth =
  | Readonly<{ error: "unauthenticated" | "local-session-required" }>
  | Readonly<{ session: AuthSession & { provider: "local" }; authSessionId: string }>;

export async function getLocalBrowserRequestAuth(): Promise<LocalBrowserRequestAuth> {
  const session = await getSession();
  if (!session) return { error: "unauthenticated" as const };
  if (session.provider !== "local") return { error: "local-session-required" as const };
  const authSessionId = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
  if (!authSessionId) return { error: "unauthenticated" as const };
  return { session: session as AuthSession & { provider: "local" }, authSessionId };
}

export function readBrowserBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 8_200 || !authorization.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice(7);
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : null;
}
