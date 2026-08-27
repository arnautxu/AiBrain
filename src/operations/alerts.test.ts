import { describe, expect, it } from "vitest";
import { evaluateOperationalAlerts } from "@/operations/alerts";
import type { BackupVerificationReceipt } from "@/operations/backup";

const now = Date.parse("2026-08-27T12:00:00.000Z");
const receipt: BackupVerificationReceipt = {
  schemaVersion: 1,
  installationId: "company-qa",
  backupId: "20260827T110000Z-11111111-1111-4111-8111-111111111111",
  sourceFingerprint: "a".repeat(64),
  backupCreatedAt: "2026-08-27T11:00:00.000Z",
  verifiedAt: "2026-08-27T11:05:00.000Z",
};

describe("operational alert evaluation", () => {
  it("is healthy only with ready services, safe disk and a fresh verified backup", () => {
    expect(evaluateOperationalAlerts({
      readiness: "ready",
      diskUsedRatio: 0.5,
      restartCount15m: 0,
      preflightFailureCount15m: 0,
      backupReceipt: receipt,
    }, { now: () => now })).toMatchObject({ status: "healthy", alerts: [] });
  });

  it("emits stable non-sensitive codes for every operating threshold", () => {
    const result = evaluateOperationalAlerts({
      readiness: "degraded",
      diskUsedRatio: 0.91,
      restartCount15m: 3,
      preflightFailureCount15m: 1,
      backupReceipt: null,
    }, { now: () => now });
    expect(result.status).toBe("critical");
    expect(result.alerts.map(({ code }) => code)).toEqual([
      "READINESS_DEGRADED",
      "DISK_PRESSURE",
      "RESTART_LOOP",
      "PREFLIGHT_FAILURE",
      "BACKUP_UNVERIFIED",
    ]);
    expect(JSON.stringify(result)).not.toContain("path");
  });

  it("does not let verification of an old snapshot satisfy freshness", () => {
    const result = evaluateOperationalAlerts({
      readiness: "ready",
      diskUsedRatio: 0.2,
      restartCount15m: 0,
      preflightFailureCount15m: 0,
      backupReceipt: {
        ...receipt,
        backupCreatedAt: "2026-08-20T00:00:00.000Z",
        verifiedAt: "2026-08-27T11:55:00.000Z",
      },
    }, { now: () => now });
    expect(result.alerts).toEqual([expect.objectContaining({ code: "BACKUP_STALE" })]);
  });
});
