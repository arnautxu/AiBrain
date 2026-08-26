import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";

export const runtime = "nodejs";

export async function GET() {
  if (!await getSession()) {
    return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Les automatitzacions programades són fora de V1.", code: "FEATURE_OUT_OF_SCOPE" },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PUT(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  if (!await getSession()) {
    return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Les automatitzacions programades són fora de V1.", code: "FEATURE_OUT_OF_SCOPE" },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}
