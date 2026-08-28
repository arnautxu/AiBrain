import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { automationStoreForSession } from "@/automations/server-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  try {
    const runs = await (await automationStoreForSession(session)).listRuns((await context.params).taskId);
    return NextResponse.json({ schemaVersion: 1, runs: runs.toReversed() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se ha podido leer el historial." }, { status: 503 });
  }
}
