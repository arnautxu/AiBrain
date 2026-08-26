import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/auth/request-security";
import { getSession } from "@/auth/session";
import { workbenchErrorResponse } from "@/workbench/http";
import { createThread } from "@/workbench/store";
import { isCreateThreadInput } from "@/workbench/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  if (!await isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!isCreateThreadInput(body)) {
    return NextResponse.json({ error: "El títol del fil no és vàlid." }, { status: 400 });
  }
  const { projectId } = await context.params;
  try {
    const thread = await createThread(session, projectId, body.title);
    return NextResponse.json(
      { thread },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return workbenchErrorResponse(error, "No s’ha pogut crear el fil.");
  }
}
