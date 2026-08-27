import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateTurnUsage,
  FileUsageStore,
  UsageStoreError,
} from "@/usage/file-usage-store";
import type {
  SharedSubscriptionSnapshot,
  TurnUsageRecord,
} from "@/usage/contracts";

const USER_ONE = "00000000-0000-4000-8000-000000000001";
const USER_TWO = "00000000-0000-4000-8000-000000000002";
const PROJECT = "10000000-0000-4000-8000-000000000001";
const THREAD = "20000000-0000-4000-8000-000000000001";
const roots: string[] = [];

async function fixture(now = Date.parse("2026-08-27T10:00:00.000Z")) {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-usage-"));
  roots.push(root);
  return {
    root,
    store: new FileUsageStore({
      installationId: "example-qa",
      dataRoot: root,
      now: () => now,
    }),
  };
}

function turn(overrides: Partial<TurnUsageRecord> = {}): TurnUsageRecord {
  return {
    schemaVersion: 1,
    installationId: "example-qa",
    userId: USER_ONE,
    projectId: PROJECT,
    threadId: THREAD,
    turnId: "30000000-0000-4000-8000-000000000001",
    status: "completed",
    startedAt: "2026-08-27T09:59:55.000Z",
    completedAt: "2026-08-27T10:00:00.000Z",
    durationMs: 5_000,
    firstTextMs: 900,
    tokenUsage: {
      totalTokens: 100,
      inputTokens: 70,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 0,
      outputTokens: 30,
      reasoningOutputTokens: 10,
    },
    tokenAttribution: "app_server_turn_event",
    ...overrides,
  };
}

function snapshot(observedAt = "2026-08-27T10:00:00.000Z"): SharedSubscriptionSnapshot {
  return {
    schemaVersion: 1,
    installationId: "example-qa",
    observedAt,
    scope: "shared_chatgpt_account",
    planType: "team",
    rateLimitsAvailable: true,
    accountTokenUsageAvailable: true,
    rateLimits: [{
      limitId: "codex",
      limitName: "Codex",
      planType: "team",
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_777_000_000 },
      secondary: null,
      credits: null,
      individualLimit: null,
      spendControlReached: false,
      rateLimitReachedType: null,
    }],
    accountTokenUsage: {
      lifetimeTokens: "1234",
      peakDailyTokens: "400",
      longestRunningTurnSec: "90",
      currentStreakDays: "2",
      longestStreakDays: "5",
      dailyUsageBuckets: [{ startDate: "2026-08-27", tokens: "200" }],
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileUsageStore", () => {
  it("records each turn exactly once and isolates personal reads", async () => {
    const { store } = await fixture();
    expect(await store.recordTurn(turn())).not.toBeNull();
    expect(await store.recordTurn(turn())).toBeNull();
    await store.recordTurn(turn({
      userId: USER_TWO,
      turnId: "30000000-0000-4000-8000-000000000002",
      tokenUsage: null,
      tokenAttribution: null,
      status: "error",
    }));

    expect(await store.listTurns(USER_ONE)).toHaveLength(1);
    expect(await store.listTurns(USER_TWO)).toHaveLength(1);
    expect(await store.listTurns()).toHaveLength(2);
    expect((await readFile(store.turnJournalPath, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("aggregates employee metrics without assigning account-wide tokens", async () => {
    const usage = aggregateTurnUsage([
      turn(),
      turn({
        turnId: "30000000-0000-4000-8000-000000000002",
        status: "error",
        durationMs: 10_000,
        firstTextMs: null,
        tokenUsage: null,
        tokenAttribution: null,
      }),
    ]);
    expect(usage).toMatchObject({
      turns: 2,
      completedTurns: 1,
      errorTurns: 1,
      averageDurationMs: 7_500,
      p95DurationMs: 10_000,
      averageFirstTextMs: 900,
      turnsWithTokenData: 1,
      tokens: { totalTokens: 100, outputTokens: 30 },
    });
  });

  it("deduplicates unchanged provider snapshots but keeps changed observations", async () => {
    const { store } = await fixture();
    expect(await store.recordSharedSubscription(snapshot())).not.toBeNull();
    expect(await store.recordSharedSubscription(snapshot("2026-08-27T10:01:00.000Z"))).toBeNull();
    expect(await store.recordSharedSubscription({
      ...snapshot("2026-08-27T10:02:00.000Z"),
      rateLimits: [{ ...snapshot().rateLimits[0], primary: { usedPercent: 13, windowDurationMins: 300, resetsAt: 1_777_000_000 } }],
    })).not.toBeNull();
    expect((await store.latestSharedSubscription())?.rateLimits[0]?.primary?.usedPercent).toBe(13);
    expect((await store.verifyAndRepair()).snapshots.count).toBe(2);
  });

  it("rejects a symlinked usage root", async () => {
    const { root, store } = await fixture();
    const target = path.join(root, "other");
    await symlink(target, path.join(root, "usage"));
    await expect(store.listTurns()).rejects.toBeInstanceOf(UsageStoreError);
  });
});
