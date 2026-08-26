import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";
import { automationCatalog, executeAutomation } from "@/automations/registry";
import { isAutomationId } from "@/lib/automation-contract";
import { readRuntimeConfig } from "@/runtime/config";
import { getProjectRuntimeContext } from "@/workbench/store";
import { isUuid } from "@/workbench/types";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  return NextResponse.json({ automations: automationCatalog }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("projectId" in body) || !isUuid(body.projectId) || !("automationId" in body) || !isAutomationId(body.automationId)) {
    return NextResponse.json({ error: "Execució no vàlida." }, { status: 400 });
  }
  try {
    const project = await getProjectRuntimeContext(session, body.projectId);
    const config = readRuntimeConfig(session.tenant.id, project.workspaceKey);
    return NextResponse.json({ run: await executeAutomation(body.automationId, config) });
  } catch {
    return NextResponse.json({ error: "No s’ha pogut executar l’automatització." }, { status: 404 });
  }
}
