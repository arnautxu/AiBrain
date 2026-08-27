import path from "node:path";
import { loadInstallationConfig } from "../src/config/installation";
import { FileBackupService } from "../src/operations/backup";

function argument(name: string, required = true) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && (!value || !path.isAbsolute(value))) {
    throw new Error(`${name} requires an absolute path.`);
  }
  return value ? path.resolve(value) : null;
}

async function main() {
  const operation = process.argv[2];
  if (operation !== "create" && operation !== "verify" && operation !== "restore") {
    throw new Error("Expected create, verify or restore operation.");
  }
  const installation = await loadInstallationConfig();
  const service = new FileBackupService(
    installation.paths.dataRoot,
    installation.paths.backupsRoot,
    installation.installationId,
  );
  if (operation === "create") {
    const result = await service.create();
    process.stdout.write(JSON.stringify({
      operation,
      backupId: result.manifest.backupId,
      sourceFingerprint: result.manifest.sourceFingerprint,
      fileCount: result.manifest.files.length,
      snapshotRoot: result.snapshotRoot,
    }) + "\n");
    return;
  }
  if (operation === "verify") {
    const snapshot = argument("--snapshot")!;
    const result = await service.verify(snapshot);
    process.stdout.write(JSON.stringify({
      operation,
      backupId: result.backupId,
      sourceFingerprint: result.sourceFingerprint,
      fileCount: result.files.length,
      verified: true,
    }) + "\n");
    return;
  }
  if (operation === "restore") {
    const snapshot = argument("--snapshot")!;
    const destination = argument("--destination")!;
    const result = await service.restore(snapshot, destination);
    process.stdout.write(JSON.stringify({
      operation,
      backupId: result.manifest.backupId,
      sourceFingerprint: result.manifest.sourceFingerprint,
      fileCount: result.manifest.files.length,
      destinationRoot: result.destinationRoot,
      restored: true,
    }) + "\n");
    return;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Backup command failed."}\n`);
  process.exitCode = 1;
});
