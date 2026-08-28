import { NextResponse } from "next/server";
import { operationalLogger } from "@/operations/server-logger";
import { getSession } from "@/auth/session";
import { isSameOriginMutation } from "@/auth/request-security";
import {
  isApprovalResolutionRequest,
  isConnectorApprovalResolutionRequest,
} from "@/lib/chat-contract";
import { loadInstallationConfig } from "@/config/installation";
import { FileApprovalStore } from "@/runtime/approval-store";

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

  try {
    const installation = await loadInstallationConfig();
    if (installation.installationId !== session.tenant.id) {
      throw new Error("Authenticated installation does not match server configuration.");
    }
    const store = new FileApprovalStore({
      installationId: installation.installationId,
      userId: session.user.id,
      usersRoot: installation.paths.usersRoot,
    });
    const locator = {
      installationId: installation.installationId,
      userId: session.user.id,
      threadId: body.threadId,
      turnId: body.turnId,
      itemId: body.itemId,
      approvalId: body.approvalId,
    };
    const connector = await store.readConnectorApproval(locator);
    if (connector) {
      if (!isConnectorApprovalResolutionRequest(body)) {
        return NextResponse.json(
          { error: "Les approvals de connector només admeten una acceptació amb el fingerprint original." },
          { status: 403 },
        );
      }
      const result = await store.approveConnectorApprovalByLocator(locator, body.authorizationFingerprint);
      if (result.outcome === "approved" || result.outcome === "already-approved") {
        return NextResponse.json({ ok: true, status: "approved" });
      }
      return NextResponse.json(
        { error: "Aquesta approval de connector ja no està pendent." },
        { status: 403 },
      );
    }
    const result = await store.resolve(locator, body.decision);
    if (result.outcome === "resolved" || result.outcome === "already-resolved") {
      return NextResponse.json({ ok: true, status: "resolved" });
    }
    return NextResponse.json(
      { error: "Aquesta aprovació ja no està pendent." },
      { status: 404 },
    );
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "APPROVAL_STORE_UNAVAILABLE";
    operationalLogger.warn("approval.decision_failed", { code });
    return NextResponse.json(
      { error: "No s’ha pogut registrar la decisió de forma segura." },
      { status: code === "APPROVAL_DECISION_CONFLICT" ? 409 : 503 },
    );
  }
}
