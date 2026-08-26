import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";
import { isApprovalResolutionRequest } from "@/lib/chat-contract";
import { resolveApproval } from "@/runtime/approval-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isApprovalResolutionRequest(body)) {
    return NextResponse.json(
      { error: "La decisió d’aprovació no és vàlida." },
      { status: 400 },
    );
  }

  if (!resolveApproval(session.tenant.id, body.approvalId, body.decision)) {
    return NextResponse.json(
      { error: "Aquesta aprovació ja no està pendent." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
