import { loadInstallationConfig } from "../src/config/installation";
import { WeeklyTokenBudgetStore } from "../src/usage/weekly-token-budget";
import { readWeeklyTokenBudgetHistory } from "../src/usage/weekly-token-budget-history";

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--offline") || args.some((arg) => arg !== "--offline" && arg !== "--apply")) {
    throw new Error("Use --offline [--apply] after stopping all installation model workers. Default: read-only preview.");
  }
  const config = await loadInstallationConfig();
  if (!config.usageLimits) throw new Error("The installation has no weekly token policy.");
  const history = await readWeeklyTokenBudgetHistory(config);
  const summary = { installationId: config.installationId, files: history.files, sessions: history.sessions,
    resets: history.resets, weeklyTokens: config.usageLimits.weeklyTokens,
    recordedTokens: history.seed.dailyTotals.reduce((sum, day) => sum + day.totalTokens, 0),
    historicalCoverage: "session-logs-only" };
  if (!args.includes("--apply")) {
    process.stdout.write(`${JSON.stringify({ ...summary, mode: "preview" })}\n`);
    return;
  }
  // Legacy ephemeral horarIA/knowledge calls may not have session logs. A
  // measured lower bound is sufficient only when it already exhausts this
  // week; otherwise importing it could silently grant unearned allowance.
  if (summary.recordedTokens < summary.weeklyTokens) {
    throw new Error("BUDGET_HISTORY_INCOMPLETE_COVERAGE: legacy session logs are below the limit; reconcile ephemeral usage before initializing.");
  }
  const store = new WeeklyTokenBudgetStore({ installationId: config.installationId,
    dataRoot: config.paths.dataRoot, limitTokens: config.usageLimits.weeklyTokens });
  const status = await store.initializeFromHistory(history.seed);
  process.stdout.write(`${JSON.stringify({ ...summary, mode: "initialized", status })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "BUDGET_INITIALIZATION_FAILED"}\n`);
  process.exitCode = 1;
});
