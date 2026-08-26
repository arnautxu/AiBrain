import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/auth/request-security";
import { getSession } from "@/auth/session";
import { isManifestEditorData } from "@/control-plane/types";
import {
  loadManifestEditorData,
  saveTenantManifest,
} from "@/control-plane/manifest-store";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "No tens permisos de propietari." }, { status: 403 });
  }
  try {
    const manifest = await loadManifestEditorData(session.tenant.id);
    if (!manifest) return NextResponse.json({ error: "Tenant no disponible." }, { status: 404 });
    return NextResponse.json({ manifest }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "No s’ha pogut carregar el manifest persistent." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autoritzat." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticat." }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "No tens permisos de propietari." }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isManifestEditorData(body)) {
    return NextResponse.json({ error: "El manifest no és vàlid." }, { status: 400 });
  }
  try {
    const manifest = await saveTenantManifest(session.tenant.id, body);
    if (!manifest) return NextResponse.json({ error: "Tenant no disponible." }, { status: 404 });
    return NextResponse.json({ manifest });
  } catch {
    return NextResponse.json(
      { error: "No s’ha pogut versionar el manifest persistent." },
      { status: 503 },
    );
  }
}
