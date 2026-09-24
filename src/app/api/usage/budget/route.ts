import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { loadInstallationConfig } from "@/config/installation";
import { WeeklyTokenBudgetStore } from "@/usage/weekly-token-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = Object.freeze({ "Cache-Control": "private, no-store" });

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Inicia sesión para consultar el saldo semanal.", code: "AUTH_REQUIRED" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const installation = await loadInstallationConfig();
    if (session.provider !== "local" || session.tenant.id !== installation.installationId) {
      return NextResponse.json(
        { error: "No tienes acceso a este saldo semanal.", code: "BUDGET_ACCESS_DENIED" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    if (!installation.usageLimits) {
      return NextResponse.json({ budget: null }, { headers: NO_STORE_HEADERS });
    }
    const status = await new WeeklyTokenBudgetStore({
      installationId: installation.installationId,
      dataRoot: installation.paths.dataRoot,
      limitTokens: installation.usageLimits.weeklyTokens,
    }).status();
    // Employees see only the shared allowance, never individual usage or provider/account data.
    return NextResponse.json({ budget: {
      weekStart: status.weekStart,
      resetAt: status.resetAt,
      usedTokens: status.usedTokens,
      limitTokens: status.limitTokens,
      remainingTokens: status.remainingTokens,
      percent: status.percent,
      threshold: status.threshold,
      initialized: status.initialized,
    } }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "No se puede comprobar el saldo semanal.", code: "WEEKLY_TOKEN_BUDGET_UNAVAILABLE" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
