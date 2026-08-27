import { loadInstallationConfig } from "../src/config/installation";
import {
  DEFAULT_DOCUMENT_TEMPORARY_GRACE_MS,
  FileDocumentTemporaryMaintenance,
} from "../src/documents/maintenance";

function hasFlag(name: string) {
  return process.argv.slice(2).includes(name);
}

function gracePeriodMs() {
  const index = process.argv.indexOf("--grace-ms");
  const argument = index >= 0 ? process.argv[index + 1] : undefined;
  if (index >= 0 && (!argument || argument.startsWith("--"))) {
    throw new Error("--grace-ms requires a positive integer.");
  }
  const value = argument ?? process.env.AIBRAIN_DOCUMENT_TEMP_GRACE_MS?.trim();
  if (value === undefined || value === "") return DEFAULT_DOCUMENT_TEMPORARY_GRACE_MS;
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error("--grace-ms/AIBRAIN_DOCUMENT_TEMP_GRACE_MS must be a positive integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Document temporary grace period is too large.");
  return parsed;
}

async function main() {
  const apply = hasFlag("--apply");
  if (hasFlag("--dry-run") && apply) throw new Error("Use either --dry-run or --apply, not both.");
  const allowed = new Set(["--apply", "--dry-run", "--grace-ms"]);
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!allowed.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    if (argument === "--grace-ms") index += 1;
  }

  const installation = await loadInstallationConfig();
  const maintenance = new FileDocumentTemporaryMaintenance({
    dataRoot: installation.paths.dataRoot,
    usersRoot: installation.paths.usersRoot,
    gracePeriodMs: gracePeriodMs(),
  });
  const report = await maintenance.run({ dryRun: !apply });
  process.stdout.write(`${JSON.stringify({
    operation: "document-temporary-maintenance",
    installationId: installation.installationId,
    ...report,
  })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Document temporary maintenance failed."}\n`);
  process.exitCode = 1;
});
