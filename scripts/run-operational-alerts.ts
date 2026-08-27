import path from "node:path";
import { loadInstallationConfig } from "../src/config/installation";
import {
  FileAlertDeliveryService,
  FileAlertSink,
  WebhookAlertSink,
} from "../src/operations/alert-delivery";
import { collectOperationalAlertInput } from "../src/operations/alert-collector";
import { evaluateOperationalAlerts } from "../src/operations/alerts";
import { FileBackupService } from "../src/operations/backup";
import { readLatestBackupReplicaReceipt } from "../src/operations/backup-replica";

function countArgument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new Error(`${name} requires a non-negative integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large.`);
  return parsed;
}

function alertSink(root: string) {
  const mode = process.env.AIBRAIN_ALERT_SINK?.trim() || "file";
  if (mode === "file") return new FileAlertSink(path.join(root, "local-sink"));
  if (mode !== "webhook") throw new Error("AIBRAIN_ALERT_SINK must be file or webhook.");
  const endpoint = process.env.AIBRAIN_ALERT_WEBHOOK_URL?.trim();
  if (!endpoint) throw new Error("AIBRAIN_ALERT_WEBHOOK_URL is required for the webhook sink.");
  const timeoutRaw = process.env.AIBRAIN_ALERT_WEBHOOK_TIMEOUT_MS?.trim() || "10000";
  if (!/^[1-9][0-9]*$/u.test(timeoutRaw)) throw new Error("AIBRAIN_ALERT_WEBHOOK_TIMEOUT_MS is invalid.");
  return new WebhookAlertSink({
    endpoint,
    bearerToken: process.env.AIBRAIN_ALERT_WEBHOOK_TOKEN?.trim() || undefined,
    timeoutMs: Number(timeoutRaw),
  });
}

async function main() {
  const installation = await loadInstallationConfig();
  const backup = new FileBackupService(
    installation.paths.dataRoot,
    installation.paths.backupsRoot,
    installation.paths.publishWriteRoot,
    installation.installationId,
  );
  const input = await collectOperationalAlertInput({
    dataRoot: installation.paths.dataRoot,
    publishWriteRoot: installation.paths.publishWriteRoot,
    readinessUrl: process.env.AIBRAIN_ALERT_READINESS_URL?.trim() || "http://127.0.0.1:3000/api/health/ready",
    egressReadinessUrl: process.env.AIBRAIN_ALERT_EGRESS_READINESS_URL?.trim(),
    allowComposeServiceReadiness: process.env.AIBRAIN_ALERT_ALLOW_COMPOSE_READINESS === "1",
    restartCount15m: countArgument("--restart-count-15m"),
    preflightFailureCount15m: countArgument("--preflight-failure-count-15m"),
    readBackupReceipt: () => backup.readVerificationReceipt(),
    readReplicaReceipt: () => {
      const stateRoot = process.env.AIBRAIN_REPLICA_STATE_ROOT?.trim();
      return stateRoot
        ? readLatestBackupReplicaReceipt(stateRoot, installation.installationId)
        : Promise.resolve(null);
    },
  });
  const evaluation = evaluateOperationalAlerts(input);
  const root = path.join(installation.paths.dataRoot, "operations", "alerts");
  const service = new FileAlertDeliveryService({
    installationId: installation.installationId,
    stateRoot: path.join(root, "delivery"),
  });
  const queued = await service.reconcile(evaluation);
  const receipts = await service.dispatch(alertSink(root));
  process.stdout.write(`${JSON.stringify({
    operation: "alerts",
    status: evaluation.status,
    evaluatedAt: evaluation.evaluatedAt,
    codes: evaluation.alerts.map((alert) => alert.code),
    queued: queued.length,
    delivered: receipts.length,
  })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Operational alert run failed."}\n`);
  process.exitCode = 1;
});
