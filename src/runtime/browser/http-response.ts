import { NextResponse } from "next/server";
import { BrowserGatewayTokenError } from "@/runtime/browser/gateway-token";
import { BrowserServiceError } from "@/runtime/browser/server-service";

export function browserAuthError(error: "unauthenticated" | "local-session-required") {
  return error === "unauthenticated"
    ? NextResponse.json({ error: "No autenticat." }, { status: 401 })
    : NextResponse.json({ error: "Cal una sessió local segura." }, { status: 403 });
}

export function browserRuntimeError(error: unknown, fallback: string) {
  if (error instanceof BrowserServiceError) {
    return NextResponse.json(
      { error: fallback, code: error.code, retryable: error.retryable },
      {
        status: error.status,
        headers: error.status === 429 ? { "Retry-After": "1" } : undefined,
      },
    );
  }
  if (error instanceof BrowserGatewayTokenError) {
    return NextResponse.json(
      { error: "La sessió del visor no és vàlida.", code: error.code, retryable: false },
      { status: error.code === "BROWSER_GATEWAY_TOKEN_EXPIRED" ? 401 : 403 },
    );
  }
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "BROWSER_RUNTIME_UNAVAILABLE";
  console.error("AiBrain browser runtime request failed", { code });
  return NextResponse.json(
    { error: fallback, code, retryable: true },
    { status: 503 },
  );
}
