import { execFile } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
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
  await Promise.all([mkdir(configRoot, { recursive: true }), mkdir(sourceRoot, { recursive: true }), mkdir(publishRoot, { recursive: true })]);
  const marker = JSON.stringify({ schemaVersion: 1, product: "aibrain", installationId });
  await Promise.all([
    writeFile(path.join(configRoot, ".aibrain-owner.json"), marker),
    writeFile(path.join(hostRoot, ".aibrain-owner.json"), marker),
    writeFile(path.join(configRoot, "installation.json"), "{}"),
    writeFile(path.join(configRoot, "runtime.env"), "NEXT_PUBLIC_SUPABASE_URL=https://project-ref.supabase.co\n"),
    writeFile(path.join(configRoot, "egress.env"), [
      `AIBRAIN_EGRESS_BROWSER_TOKEN=${"a".repeat(96)}`,
      `AIBRAIN_EGRESS_WORKER_TOKEN=${"b".repeat(96)}`,
      `AIBRAIN_EGRESS_SERVER_TOKEN=${"c".repeat(96)}`,
      "AIBRAIN_EGRESS_WORKER_HOSTS=api.openai.com",
      "AIBRAIN_EGRESS_SUPABASE_ORIGIN=https://project-ref.supabase.co",
      "",
    ].join("\n")),
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
    AIBRAIN_HOST_ROOT: hostRoot,
    AIBRAIN_SOURCE_HOST_PATH: sourceRoot,
    AIBRAIN_PUBLISH_HOST_PATH: publishRoot,
    AIBRAIN_HTTP_PORT: "43100",
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
});
