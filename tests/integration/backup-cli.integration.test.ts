import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const repositoryRoot = process.cwd();
const executable = path.join(repositoryRoot, "node_modules", ".bin", "tsx");
const script = path.join(repositoryRoot, "scripts", "backup.ts");
const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-backup-cli-"));
  roots.push(root);
  const dataRoot = path.join(root, "data");
  const backupsRoot = path.join(dataRoot, "backups");
  const companyContextRoot = path.join(dataRoot, "company-context");
  const usersRoot = path.join(dataRoot, "users");
  const sourceReadRoot = path.join(root, "source-ro");
  const publishWriteRoot = path.join(root, "publish-rw");
  await Promise.all([
    mkdir(backupsRoot, { recursive: true, mode: 0o700 }),
    mkdir(companyContextRoot, { recursive: true, mode: 0o700 }),
    mkdir(usersRoot, { recursive: true, mode: 0o700 }),
    mkdir(sourceReadRoot, { recursive: true, mode: 0o700 }),
    mkdir(publishWriteRoot, { recursive: true, mode: 0o700 }),
  ]);
  await writeFile(path.join(companyContextRoot, "context.md"), "Company context v1\n", { mode: 0o600 });
  const configPath = path.join(root, "installation.json");
  await writeFile(configPath, `${JSON.stringify({
    schemaVersion: 1,
    installationId: "backup-cli-qa",
    companyName: "Backup CLI QA",
    companySlug: "backup-cli-qa",
    publicUrl: "https://backup-cli.example.test",
    branding: {
      productName: "Backup CLI Brain",
      logoPath: "/branding/backup-cli-qa/logo.svg",
      faviconPath: "/branding/backup-cli-qa/favicon.svg",
      accentColor: "#123abc",
    },
    paths: { dataRoot, companyContextRoot, usersRoot, sourceReadRoot, publishWriteRoot, backupsRoot },
  })}\n`, { mode: 0o600 });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    AIBRAIN_INSTALLATION_CONFIG: configPath,
    NODE_ENV: "test",
  };
  return {
    root,
    dataRoot,
    configPath,
    environment,
  };
}

afterEach(async () => {
  async function makeWritable(directory: string) {
    let entries;
    try {
      await chmod(directory, 0o700);
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) =>
      makeWritable(path.join(directory, entry.name))));
  }
  await Promise.all(roots.splice(0).map(async (root) => {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  }));
});

describe("backup operational CLI", () => {
  it("creates, verifies and restores a real filesystem snapshot in separate processes", async () => {
    const test = await fixture();
    const created = await execFile(executable, [script, "create"], {
      cwd: repositoryRoot,
      env: test.environment,
    });
    const createReceipt = JSON.parse(created.stdout) as {
      operation: string;
      snapshotRoot: string;
      sourceFingerprint: string;
      fileCount: number;
    };
    expect(createReceipt).toMatchObject({ operation: "create", fileCount: 1 });
    expect(createReceipt.snapshotRoot).toContain(path.join(test.dataRoot, "backups", "snapshots"));

    const verified = await execFile(executable, [script, "verify", "--snapshot", createReceipt.snapshotRoot], {
      cwd: repositoryRoot,
      env: test.environment,
    });
    expect(JSON.parse(verified.stdout)).toMatchObject({
      operation: "verify",
      verified: true,
      sourceFingerprint: createReceipt.sourceFingerprint,
    });

    const destination = path.join(test.root, "restored");
    const restored = await execFile(executable, [
      script,
      "restore",
      "--snapshot",
      createReceipt.snapshotRoot,
      "--destination",
      destination,
    ], { cwd: repositoryRoot, env: test.environment });
    expect(JSON.parse(restored.stdout)).toMatchObject({
      operation: "restore",
      restored: true,
      destinationRoot: destination,
      sourceFingerprint: createReceipt.sourceFingerprint,
    });
    expect(await readFile(path.join(destination, "company-context", "context.md"), "utf8"))
      .toBe("Company context v1\n");
  });

  it("rejects invalid operations and missing absolute arguments with a non-zero exit", async () => {
    const test = await fixture();
    await expect(execFile(executable, [script, "invalid"], {
      cwd: repositoryRoot,
      env: test.environment,
    })).rejects.toMatchObject({ stderr: expect.stringContaining("Expected create, verify or restore operation.") });
    await expect(execFile(executable, [script, "verify"], {
      cwd: repositoryRoot,
      env: test.environment,
    })).rejects.toMatchObject({ stderr: expect.stringContaining("--snapshot requires an absolute path.") });
  });
});
