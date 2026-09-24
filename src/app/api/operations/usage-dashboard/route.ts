import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { operatorUsageDashboard } from "@/usage/operator-dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store" });

function configuredSecret() {
  const secret = (process.env.AIBRAIN_USAGE_DASHBOARD_SECRET ?? "").trim();
  return secret.length >= 32 && secret.length <= 512 && !/\s/u.test(secret) ? secret : null;
}

function authorized(request: Request) {
  const secret = configuredSecret();
  const match = /^Bearer ([^\s]+)$/u.exec(request.headers.get("authorization") ?? "");
  if (!secret || !match) return false;
  const expected = createHash("sha256").update(secret).digest();
  const received = createHash("sha256").update(match[1]).digest();
  return timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Operator authentication required.", code: "OPERATOR_AUTH_REQUIRED" },
      { status: 401, headers: { ...HEADERS, "WWW-Authenticate": "Bearer" } },
    );
  }
  try {
    return NextResponse.json(await operatorUsageDashboard(), { headers: HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Usage dashboard is unavailable.", code: "USAGE_DASHBOARD_UNAVAILABLE" },
      { status: 503, headers: HEADERS },
    );
  }
}
