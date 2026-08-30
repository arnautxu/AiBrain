import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const gatewayPath = path.join(process.cwd(), "infra", "hetzner", "app", "deploy-arnall-main.sh");

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true, () => false);
}

async function runLegacyCleanup(withTransaction = false): Promise<{ output: string; root: string; status: number }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aibrain-storage-retention-"));
  roots.push(root);
  const releaseRoot = path.join(root, "release-root");
  const releases = path.join(releaseRoot, "releases");
  const state = path.join(root, "release-state.json");
  const current = "a".repeat(40);
  const previous = "b".repeat(40);
  await mkdir(releases, { recursive: true });
  for (const revision of [current, current.slice(0, 7), previous, previous.slice(0, 7), "c".repeat(40), "d".repeat(7), "do-not-delete"]) {
    await mkdir(path.join(releases, revision));
  }
  await writeFile(state, `${JSON.stringify({ current: { revision: current }, previous: { revision: previous } })}\n`, { mode: 0o600 });
  if (withTransaction) await writeFile(`${state}.transaction.json`, "{}\n", { mode: 0o600 });

  const gateway = await readFile(gatewayPath, "utf8");
  const sourceable = gateway
    .replace(/readonly RELEASE_ROOT="[^"]+"/u, `readonly RELEASE_ROOT="${releaseRoot}"`)
    .replace(/readonly STATE_FILE="[^"]+"/u, `readonly STATE_FILE="${state}"`)
    .replace(/\nmain "\$@"\n$/u, "\n");
  const script = path.join(root, "cleanup.sh");
  await writeFile(script, `#!/usr/bin/env bash
set -euo pipefail
stat() {
  if [[ "$1 $2" == "-c %u" ]]; then printf '0\\n'; return 0; fi
  if [[ "$1 $2" == "-c %a" ]]; then printf '755\\n'; return 0; fi
  command stat "$@"
}
rm() {
  if [[ "\${1:-}" == "-rf" && "\${2:-}" == "--one-file-system" && "\${3:-}" == "--" ]]; then
    command rm -rf -- "$4"
  else
    command rm "$@"
  fi
}
${sourceable}
cleanup_legacy_release_directories
`, { mode: 0o700 });

  try {
    const output = execFileSync("bash", [script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { output, root, status: 0 };
  } catch (error) {
    const output = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    return { output, root, status: 1 };
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Arnall host storage retention contract", () => {
  it("removes only recognized inactive legacy release directories", async () => {
    const result = await runLegacyCleanup();
    const releases = path.join(result.root, "release-root", "releases");

    expect(result.status).toBe(0);
    expect(await exists(path.join(releases, "a".repeat(40)))).toBe(true);
    expect(await exists(path.join(releases, "a".repeat(7)))).toBe(true);
    expect(await exists(path.join(releases, "b".repeat(40)))).toBe(true);
    expect(await exists(path.join(releases, "b".repeat(7)))).toBe(true);
    expect(await exists(path.join(releases, "c".repeat(40)))).toBe(false);
    expect(await exists(path.join(releases, "d".repeat(7)))).toBe(false);
    expect(await exists(path.join(releases, "do-not-delete"))).toBe(true);
    expect(result.output).toContain("ARNALL_RELEASE_DIRECTORY_REMOVED");
  });

  it("fails closed while a release transaction exists", async () => {
    const result = await runLegacyCleanup(true);
    const stale = path.join(result.root, "release-root", "releases", "c".repeat(40));

    expect(result.status).toBe(1);
    expect(result.output).toContain("release transaction exists");
    expect(await exists(stale)).toBe(true);
  });

  it("ships a persistent 512 MB journald cap", async () => {
    const config = await readFile(
      path.join(process.cwd(), "infra", "hetzner", "systemd", "journald-disk-retention.conf"),
      "utf8",
    );

    expect(config).toBe("[Journal]\nSystemMaxUse=512M\n");
  });
});
