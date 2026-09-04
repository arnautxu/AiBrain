import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { startComposio } from "@/connectors/composio-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, context: { params: Promise<{ toolkit: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Inicia sesión para conectar tu cuenta." }, { status: 401, headers });
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Origen no autorizado." }, { status: 403, headers });
  try { return NextResponse.redirect(await startComposio(session, (await context.params).toolkit), 303); }
  catch { return NextResponse.json({ error: "No se pudo iniciar la conexión. El administrador debe revisar el proveedor y los permisos." }, { status: 503, headers }); }
}
