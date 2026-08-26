import { NextResponse } from "next/server";
import { LocalAuthError } from "@/auth/auth-service";
import { createLocalAuthService } from "@/auth/auth-context";
import { IdentityProviderError } from "@/auth/identity-provider";
import { isSameOriginMutation } from "@/auth/request-security";
import { setLocalSessionCookie } from "@/auth/session-cookie";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Petició no vàlida." }, { status: 400 });
  }
  const password = "password" in body && typeof body.password === "string" ? body.password : "";
  const confirmation = "confirmation" in body && typeof body.confirmation === "string"
    ? body.confirmation : "";
  const code = "code" in body && typeof body.code === "string" ? body.code : undefined;
  const tokenHash = "tokenHash" in body && typeof body.tokenHash === "string"
    ? body.tokenHash : undefined;
  if (password !== confirmation || (!!code === !!tokenHash)) {
    return NextResponse.json({ error: "Petició de recuperació no vàlida." }, { status: 400 });
  }
  try {
    const result = await (await createLocalAuthService()).completePasswordRecovery(
      code ? { code } : { tokenHash: tokenHash! },
      password,
    );
    await setLocalSessionCookie(result.session);
    return NextResponse.json(
      { authenticated: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof LocalAuthError && error.code === "invalid_input") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof IdentityProviderError && error.code === "provider_unavailable") {
      return NextResponse.json({ error: "El servei d’identitat no està disponible." }, { status: 503 });
    }
    return NextResponse.json({ error: "L’enllaç de recuperació no és vàlid o ha caducat." }, { status: 401 });
  }
}
