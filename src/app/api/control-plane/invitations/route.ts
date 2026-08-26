import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  if (!await getSession()) {
    return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  }
  return NextResponse.json(
    {
      error: "Les identitats es creen fora del runtime i es provisionen amb users:provision.",
      code: "OPERATOR_PROVISIONING_REQUIRED",
    },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}
