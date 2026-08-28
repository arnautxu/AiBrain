import { NextResponse } from "next/server";
import { isWorkspaceAdmin } from "@/admin/server-service";
import { getSession } from "@/auth/session";
import { companyUsageForUser } from "@/usage/server-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = Object.freeze({ "Cache-Control": "private, no-store" });

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autenticat.", code: "AUTH_REQUIRED" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!await isWorkspaceAdmin(session)) {
    return NextResponse.json(
      { error: "No tens permisos per consultar l’ús de l’empresa.", code: "USAGE_ADMIN_REQUIRED" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  try {
    return NextResponse.json(
      await companyUsageForUser(session.user.id),
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "No s’ha pogut consultar l’ús de l’empresa.", code: "USAGE_UNAVAILABLE" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
