import { pathToFileURL } from "node:url";
import { loadInstallationConfig } from "../src/config/installation";
import type { InstallationConfig } from "../src/config/installation-schema";
import { WeeklyTokenBudgetStore } from "../src/usage/weekly-token-budget";
import { readWeeklyTokenBudgetHistory } from "../src/usage/weekly-token-budget-history";

export function parseWeeklyTokenBudgetArguments(args: readonly string[]) {
  if (!args.includes("--offline") || new Set(args).size !== args.length ||
      args.some((arg) => !["--offline", "--apply", "--start-now"].includes(arg))) {
    throw new Error("Use --offline [--apply] [--start-now] after stopping all installation model workers. Default: read-only history preview. --start-now grants the explicitly authorized initial allowance without charging prior usage.");
  }
  return { apply: args.includes("--apply"), startNow: args.includes("--start-now") };
}

export async function initializeWeeklyTokenBudget(
  config: Readonly<Pick<InstallationConfig, "installationId" | "paths" | "usageLimits">>,
  options: ReturnType<typeof parseWeeklyTokenBudgetArguments>,
  now = new Date(),
) {
  if (!config.usageLimits) throw new Error("The installation has no weekly token policy.");
  const history = await readWeeklyTokenBudgetHistory(config, now, { startNow: options.startNow });
  const summary = { installationId: config.installationId, files: history.files, sessions: history.sessions,
    resets: history.resets, weeklyTokens: config.usageLimits.weeklyTokens,
    recordedTokens: history.seed.dailyTotals.reduce((sum, day) => sum + day.totalTokens, 0),
    historicalCoverage: options.startNow ? "pre-activation-usage-excluded" : "session-logs-only",
    initializationPolicy: options.startNow ? "start-now" : "include-history",
    countingStartsAt: history.seed.capturedAt };
  if (!options.apply) return { ...summary, mode: "preview" };
  // Legacy ephemeral horarIA/knowledge calls may not have session logs. A
  // measured lower bound is sufficient only when it already exhausts this
  // week; otherwise importing it could silently grant unearned allowance.
  if (!options.startNow && summary.recordedTokens < summary.weeklyTokens) {
    throw new Error("BUDGET_HISTORY_INCOMPLETE_COVERAGE: legacy session logs are below the limit; reconcile ephemeral usage before initializing.");
  }
  const store = new WeeklyTokenBudgetStore({ installationId: config.installationId,
    dataRoot: config.paths.dataRoot, limitTokens: config.usageLimits.weeklyTokens, now: () => now.getTime() });
  const status = await store.initializeFromHistory(history.seed);
  return { ...summary, mode: "initialized", status };
}

async function main() {
  const options = parseWeeklyTokenBudgetArguments(process.argv.slice(2));
  const config = await loadInstallationConfig();
  const result = await initializeWeeklyTokenBudget(config, options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "BUDGET_INITIALIZATION_FAILED"}\n`);
    process.exitCode = 1;
  });
}
