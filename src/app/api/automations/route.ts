import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";
import { parseAutomationInput } from "@/automations/contracts";
import { automationStoreForSession } from "@/automations/server-service";
import { loadInstallationConfig } from "@/config/installation";
import { readAutomationWorkerStatus } from "@/automations/worker-status";
import { getProject } from "@/workbench/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

function errorResponse(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "AUTOMATION_UNAVAILABLE";
  const status = code === "AUTOMATION_DATE_PAST" ? 400 : code === "AUTOMATION_NOT_FOUND" ? 404 : 503;
  return NextResponse.json({ error: error instanceof Error ? error.message : "No se ha podido gestionar la automatización.", code }, { status, headers: HEADERS });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401, headers: HEADERS });
  try {
    const [tasks, installation] = await Promise.all([
      (await automationStoreForSession(session)).list(),
      loadInstallationConfig(),
    ]);
    return NextResponse.json({
      schemaVersion: 1,
      tasks,
      worker: await readAutomationWorkerStatus(installation.paths.dataRoot),
      executionMode: "local-worker",
    }, { headers: HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!await isSameOriginMutation(request)) return NextResponse.json({ error: "Origen no autorizado." }, { status: 403, headers: HEADERS });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401, headers: HEADERS });
  const input = parseAutomationInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Revisa el nombre, prompt, proyecto y horario." }, { status: 400, headers: HEADERS });
  try {
    const project = await getProject(session, input.projectId);
    const task = await (await automationStoreForSession(session)).create({ ...input, projectName: project.name });
    return NextResponse.json({ schemaVersion: 1, task }, { status: 201, headers: HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
