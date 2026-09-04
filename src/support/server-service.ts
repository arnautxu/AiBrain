import "server-only";

import type { AuthSession } from "@/auth/types";
import { loadInstallationConfig } from "@/config/installation";
import { operationalLogger } from "@/operations/server-logger";
import type { SupportRequest, SupportRequestInput } from "@/support/contracts";
import { FileSupportRequestStore } from "@/support/store";

type Fetcher = typeof fetch;

function telegramUrl(token: string) {
  return `https://api.telegram.org/bot${token}/sendMessage`;
}

async function notify(request: SupportRequest, fetcher: Fetcher) {
  const webhook = process.env.AIBRAIN_SUPPORT_WEBHOOK_URL?.trim();
  const telegramToken = process.env.AIBRAIN_SUPPORT_TELEGRAM_BOT_TOKEN?.trim();
  const telegramChatId = process.env.AIBRAIN_SUPPORT_TELEGRAM_CHAT_ID?.trim();
  const summary = `[AiBrain ${request.kind}] ${request.description.slice(0, 1_500)}\n${request.context.pathname}\nRequest ${request.id}`;
  if (webhook) {
    const url = new URL(webhook);
    if (url.protocol !== "https:") throw new Error("Support webhook must use HTTPS.");
    const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      schemaVersion: 1, requestId: request.id, kind: request.kind, description: request.description,
      context: request.context, createdAt: request.createdAt,
    }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Support webhook returned ${response.status}.`);
    return true;
  }
  if (telegramToken && telegramChatId) {
    const response = await fetcher(telegramUrl(telegramToken), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: telegramChatId, text: summary }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Telegram returned ${response.status}.`);
    return true;
  }
  return false;
}

export async function createSupportRequest(session: AuthSession, input: SupportRequestInput, fetcher: Fetcher = fetch) {
  const installation = await loadInstallationConfig();
  if (session.provider !== "local" || session.tenant.id !== installation.installationId) {
    const error = new Error("La ayuda requiere una cuenta local de esta instalación.") as Error & { code: string };
    error.code = "SUPPORT_IDENTITY_REQUIRED";
    throw error;
  }
  const store = new FileSupportRequestStore(installation.installationId, session.user.id, installation.paths.usersRoot);
  const request = await store.create(input);
  try {
    const delivered = await notify(request, fetcher);
    await store.setNotification(request.id, delivered ? "delivered" : "not_configured");
  } catch (error) {
    await store.setNotification(request.id, "failed").catch(() => undefined);
    operationalLogger.warn("support.notification_failed", { error, supportRequestId: request.id, installationId: installation.installationId, userId: session.user.id });
  }
  return { id: request.id, createdAt: request.createdAt };
}
