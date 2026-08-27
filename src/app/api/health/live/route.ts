import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const processStartedAt = new Date(Date.now() - Math.round(process.uptime() * 1_000)).toISOString();

export async function GET() {
  return NextResponse.json(
    {
      schemaVersion: 1,
      status: "live",
      processStartedAt,
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
