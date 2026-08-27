import { execFile } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const script = path.resolve("scripts/validate-host-preflight.mjs");

async function fixture(installationId = "company-alpha") {
  const root = await mkdtemp(path.join(os.tmpdir(), "aibrain-host-preflight-"));
  const configRoot = path.join(root, "config", installationId);
  const hostRoot = path.join(root, `aibrain-${installationId}`);
  const sourceRoot = path.join(hostRoot, "source-ro");
  const publishRoot = path.join(hostRoot, "publish-rw");
  const replicaStateRoot = path.join(hostRoot, "replication");
  await Promise.all([
    mkdir(configRoot, { recursive: true }),
    mkdir(sourceRoot, { recursive: true }),
    mkdir(publishRoot, { recursive: true }),
    mkdir(replicaStateRoot, { recursive: true }),
  ]);
  await Promise.all([
    chmod(sourceRoot, 0o550),
    chmod(publishRoot, 0o750),
    chmod(replicaStateRoot, 0o700),
  ]);
  const marker = JSON.stringify({ schemaVersion: 1, product: "aibrain", installationId });
  await Promise.all([
    writeFile(path.join(configRoot, ".aibrain-owner.json"), marker),
    writeFile(path.join(hostRoot, ".aibrain-owner.json"), marker),
    writeFile(path.join(configRoot, "installation.json"), "{}"),
    writeFile(path.join(configRoot, "runtime.env"), "NEXT_PUBLIC_SUPABASE_URL=https://project-ref.supabase.co\n", { mode: 0o600 }),
    writeFile(path.join(configRoot, "egress.env"), [
      `AIBRAIN_EGRESS_BROWSER_TOKEN=${"a".repeat(96)}`,
      `AIBRAIN_EGRESS_WORKER_TOKEN=${"b".repeat(96)}`,
      `AIBRAIN_EGRESS_SERVER_TOKEN=${"c".repeat(96)}`,
      "AIBRAIN_EGRESS_WORKER_HOSTS=api.openai.com",
      "AIBRAIN_EGRESS_SUPABASE_ORIGIN=https://project-ref.supabase.co",
      "",
    ].join("\n"), { mode: 0o600 }),
    writeFile(path.join(configRoot, "alerts.env"), [
      "AIBRAIN_ALERT_SINK=webhook",
      "AIBRAIN_ALERT_WEBHOOK_URL=https://alerts.example.test/aibrain",
      `AIBRAIN_ALERT_WEBHOOK_TOKEN=${"d".repeat(96)}`,
      "",
    ].join("\n"), { mode: 0o600 }),
    writeFile(path.join(configRoot, "replica.env"), [
      "AIBRAIN_RESTIC_REPOSITORY=s3:https://backup.example.test/company-alpha",
      "AWS_ACCESS_KEY_ID=synthetic",
      "AWS_SECRET_ACCESS_KEY=synthetic",
      "",
    ].join("\n"), { mode: 0o600 }),
    writeFile(path.join(configRoot, "restic-password"), "synthetic-password\n", { mode: 0o400 }),
  ]);
  const envFile = path.join(root, "compose.env");
  const values = {
    AIBRAIN_INSTALLATION_ID: installationId,
    AIBRAIN_COMPOSE_PROJECT_NAME: `aibrain-${installationId}`,
    AIBRAIN_NETWORK_NAME: `aibrain-${installationId}-private`,
    AIBRAIN_EGRESS_NETWORK_NAME: `aibrain-${installationId}-egress`,
    AIBRAIN_IMAGE: `registry.example.test/aibrain@sha256:${"a".repeat(64)}`,
    AIBRAIN_EGRESS_IMAGE: `registry.example.test/aibrain-egress@sha256:${"b".repeat(64)}`,
    AIBRAIN_DATA_VOLUME_NAME: `aibrain-${installationId}-data`,
    AIBRAIN_BACKUP_VOLUME_NAME: `aibrain-${installationId}-backups`,
    AIBRAIN_RESTORE_VOLUME_NAME: `aibrain-${installationId}-restores`,
    AIBRAIN_INSTALLATION_CONFIG_HOST: path.join(configRoot, "installation.json"),
    AIBRAIN_RUNTIME_ENV_FILE: path.join(configRoot, "runtime.env"),
    AIBRAIN_EGRESS_ENV_FILE: path.join(configRoot, "egress.env"),
    AIBRAIN_ALERTS_ENV_FILE: path.join(configRoot, "alerts.env"),
    AIBRAIN_REPLICA_ENV_FILE: path.join(configRoot, "replica.env"),
    AIBRAIN_RESTIC_PASSWORD_FILE_HOST: path.join(configRoot, "restic-password"),
    AIBRAIN_HOST_ROOT: hostRoot,
    AIBRAIN_SOURCE_HOST_PATH: sourceRoot,
    AIBRAIN_PUBLISH_HOST_PATH: publishRoot,
    AIBRAIN_REPLICA_STATE_HOST_PATH: replicaStateRoot,
    AIBRAIN_HTTP_PORT: "43100",
    AIBRAIN_UID: String(typeof process.getuid === "function" ? process.getuid() : 10001),
    AIBRAIN_GID: String(typeof process.getgid === "function" ? process.getgid() : 10001),
  };
  await writeFile(envFile, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
  return { root, envFile, values, configRoot, hostRoot, sourceRoot };
}

async function run(envFile: string, installationId = "company-alpha") {
  return execFileAsync(process.execPath, [script, "--env-file", envFile, "--installation", installationId], {
    env: { ...process.env, AIBRAIN_PREFLIGHT_ALLOW_OFFLINE: "1" },
  });
}

describe("Hetzner host preflight", () => {
  it("accepts an exclusively owned installation layout without reading secrets", async () => {
    const input = await fixture();
    const result = await run(input.envFile);
    expect(result.stdout).toContain("AiBrain host preflight: PASS (company-alpha)");
  });

  it("rejects mismatched ownership, overlapping paths, symlinks and BGreenly paths", async () => {
    const ownership = await fixture();
    await writeFile(path.join(ownership.hostRoot, ".aibrain-owner.json"), JSON.stringify({ schemaVersion: 1, product: "aibrain", installationId: "someone-else" }));
    await expect(run(ownership.envFile)).rejects.toThrow();

    const symlinked = await fixture();
    const link = path.join(symlinked.root, "source-link");
    await symlink(symlinked.sourceRoot, link);
    const envWithLink = (await import("node:fs/promises")).readFile(symlinked.envFile, "utf8").then((text) => text.replace(`AIBRAIN_SOURCE_HOST_PATH=${symlinked.sourceRoot}`, `AIBRAIN_SOURCE_HOST_PATH=${link}`));
    await writeFile(symlinked.envFile, await envWithLink);
    await expect(run(symlinked.envFile)).rejects.toThrow();

    const bgreenly = await fixture("bgreenly");
    await expect(run(bgreenly.envFile, "bgreenly")).rejects.toThrow();
  });

  it("rejects exposed secrets and hard-linked policy files", async () => {
    const exposed = await fixture();
    await chmod(path.join(exposed.configRoot, "runtime.env"), 0o644);
    await expect(run(exposed.envFile)).rejects.toThrow();

    const hardLinked = await fixture();
    await link(path.join(hardLinked.configRoot, "egress.env"), path.join(hardLinked.configRoot, "egress-copy.env"));
    await expect(run(hardLinked.envFile)).rejects.toThrow();
  });
});
