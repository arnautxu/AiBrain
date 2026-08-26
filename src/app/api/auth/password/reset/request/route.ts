import { NextResponse } from "next/server";
import { createLocalAuthService } from "@/auth/auth-context";
import { IdentityProviderError } from "@/auth/identity-provider";
import { getPublicOrigin } from "@/auth/public-url";
import { isSameOriginMutation } from "@/auth/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  const email = body && typeof body === "object" && "email" in body &&
    typeof body.email === "string" ? body.email : "";
  try {
    await (await createLocalAuthService()).requestPasswordRecovery(
      email,
      `${await getPublicOrigin()}/auth/recovery`,
    );
  } catch (error) {
    if (error instanceof IdentityProviderError && error.code === "provider_unavailable") {
      return NextResponse.json({ error: "El servei d’identitat no està disponible." }, { status: 503 });
    }
    // Deliberately indistinguishable for unknown, disabled and malformed accounts.
  }
  return NextResponse.json(
    { accepted: true },
    { status: 202, headers: { "Cache-Control": "private, no-store" } },
  );
}
