import "server-only";

import { readdir } from "node:fs/promises";
import { FileLocalUserStore, type LocalUser } from "@/auth/local-user-store";
import { loadInstallationConfig } from "@/config/installation";
import { aggregateTurnUsage, FileUsageStore } from "@/usage/file-usage-store";
import { WeeklyTokenBudgetStore, weeklyTokenBudgetWindow } from "@/usage/weekly-token-budget";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function localUsers(usersRoot: string): Promise<LocalUser[]> {
  const store = new FileLocalUserStore(usersRoot);
  const entries = await readdir(usersRoot, { withFileTypes: true });
  const users = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && UUID.test(entry.name))
    .map((entry) => store.read(entry.name)));
  return users.filter((user): user is LocalUser => user !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function operatorUsageDashboard(now = Date.now()) {
  const installation = await loadInstallationConfig();
  if (!installation.usageLimits) throw new Error("Weekly usage is not configured.");

  const window = weeklyTokenBudgetWindow(now);
  const usageStore = new FileUsageStore({
    installationId: installation.installationId,
    dataRoot: installation.paths.dataRoot,
    now: () => now,
  });
  const budgetStore = new WeeklyTokenBudgetStore({
    installationId: installation.installationId,
    dataRoot: installation.paths.dataRoot,
    limitTokens: installation.usageLimits.weeklyTokens,
    now: () => now,
  });
  const [users, turns, budget, countingStartsAt] = await Promise.all([
    localUsers(installation.paths.usersRoot),
    usageStore.listTurns(),
    budgetStore.status(),
    budgetStore.countingStartsAt(),
  ]);
  const start = Date.parse(window.weekStart);
  const end = Date.parse(window.resetAt);

  const members = users.map((user) => {
    const memberTurns = turns.filter((turn) => {
      const completedAt = Date.parse(turn.completedAt);
      return turn.userId === user.userId && completedAt >= start && completedAt < end;
    });
    const aggregate = aggregateTurnUsage(memberTurns);
    const daily = new Map<string, { date: string; turns: number; totalTokens: number }>();
    for (const turn of memberTurns) {
      const date = turn.completedAt.slice(0, 10);
      const item = daily.get(date) ?? { date, turns: 0, totalTokens: 0 };
      item.turns += 1;
      item.totalTokens += turn.tokenUsage?.totalTokens ?? 0;
      daily.set(date, item);
    }
    return {
      displayName: user.displayName,
      email: user.email,
      enabled: user.enabled,
      turns: aggregate.turns,
      completedTurns: aggregate.completedTurns,
      activeDays: aggregate.activeDays,
      totalTokens: aggregate.tokens.totalTokens,
      inputTokens: aggregate.tokens.inputTokens,
      cachedInputTokens: aggregate.tokens.cachedInputTokens,
      outputTokens: aggregate.tokens.outputTokens,
      lastActiveAt: memberTurns.at(-1)?.completedAt ?? null,
      daily: [...daily.values()].sort((left, right) => left.date.localeCompare(right.date)),
    };
  }).sort((left, right) => right.totalTokens - left.totalTokens || left.displayName.localeCompare(right.displayName));

  return {
    schemaVersion: 1 as const,
    generatedAt: new Date(now).toISOString(),
    companyName: installation.companyName,
    period: {
      startsAt: window.weekStart,
      resetsAt: window.resetAt,
      countingStartsAt,
    },
    budget: {
      limitTokens: budget.limitTokens,
      usedTokens: budget.usedTokens ?? 0,
      remainingTokens: budget.remainingTokens ?? budget.limitTokens,
      usedPercent: budget.percent ?? 0,
      remainingPercent: Math.max(0, 100 - (budget.percent ?? 0)),
    },
    members,
  };
}
