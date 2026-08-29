import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const gatewayPath = path.join(process.cwd(), "infra", "hetzner", "app", "deploy-arnall-main.sh");

describe("Arnall deployment gateway contract", () => {
  it("pulls only approved immutable GHCR images and never builds or archives source on the host", async () => {
    const gateway = await readFile(gatewayPath, "utf8");
    expect(gateway).toContain('readonly GHCR_APP_REPOSITORY="ghcr.io/arnautxu/aibrain"');
    expect(gateway).toContain('readonly GHCR_EGRESS_REPOSITORY="ghcr.io/arnautxu/aibrain-egress"');
    expect(gateway).toContain('docker --config "$ghcr_docker_config" pull "$app_image"');
    expect(gateway).toContain('docker --config "$ghcr_docker_config" pull "$egress_image"');
    expect(gateway).toContain('node "${OPS_ROOT}/manage-release.mjs"');
    expect(gateway).toContain('local compose_file="${OPS_ROOT}/compose.yaml"');
    expect(gateway).toContain('require_root_owned_file "${OPS_ROOT}/browser/seccomp_profile.json"');
    expect(gateway).toContain('readonly AUTOMATION_WORKER_ENABLED="true"');
    expect(gateway).toContain("automation_worker_is_healthy");
    expect(gateway).toContain('worker_state" == "true|healthy"');
    expect(gateway).toContain('cleanup_previous_aibrain_images');
    expect(gateway).not.toContain("docker buildx prune");
    expect(gateway).not.toContain("docker build ");
    expect(gateway).not.toContain("docker push ");
    expect(gateway).not.toContain("git archive");
  });

  it("keeps GHCR credentials in a temporary Docker config and rejects other image repositories", async () => {
    const gateway = await readFile(gatewayPath, "utf8");

    expect(gateway).toContain('ghcr_docker_config="$(mktemp -d "${RELEASE_ROOT}/.ghcr-docker.XXXXXX")"');
    expect(gateway).toContain("trap cleanup_ghcr_credentials EXIT");
    expect(gateway).toContain('rm -rf --one-file-system -- "$ghcr_docker_config"');
    expect(gateway).toContain("application image is not the approved GHCR repository and digest");
    expect(gateway).toContain("egress image is not the approved GHCR repository and digest");
  });

  it("adds post-deploy readbacks after health validation, with separate fail-closed sources", async () => {
    const gateway = await readFile(gatewayPath, "utf8");
    const deployment = gateway.indexOf('node "${OPS_ROOT}/manage-release.mjs"');
    const health = gateway.indexOf("/api/health/ready");
    const collection = gateway.indexOf("collect_release_readbacks()");

    expect(deployment).toBeGreaterThan(-1);
    expect(health).toBeGreaterThan(deployment);
    expect(collection).toBeGreaterThan(health);
    for (const required of [
      "^collect-readbacks\\ ([0-9a-f]{40})\\ ([0-9]{6,20})$",
      "release state is unavailable",
      "release state does not match the requested candidate",
      "application container is unavailable",
      "gateway container is unavailable",
      "backend-ci-source.json",
      "acceptance-release-readbacks.json",
      "collect-release-readbacks.mjs",
      'require_root_owned_file "${OPS_ROOT}/collect-release-readbacks.mjs"',
      "docker compose --env-file \"$ACTIVE_ENV\" -f \"$compose_file\" ps -q app",
      "docker compose --env-file \"$ACTIVE_ENV\" -f \"$compose_file\" ps -q ingress-gateway",
    ]) expect(gateway).toContain(required);
    expect(gateway).toMatch(/collect-release-readbacks\.mjs[\s\S]*--candidate-sha "\$revision"[\s\S]*--release-state "\$STATE_FILE"/u);
  });

  it("preflights the collector runtime before any build or promotion", async () => {
    const gateway = await readFile(gatewayPath, "utf8");
    const deploy = gateway.indexOf("deploy_ghcr_release()");
    const runtimeCheck = gateway.indexOf("  require_release_readback_runtime", deploy);
    const promotion = gateway.indexOf('node "${OPS_ROOT}/manage-release.mjs"');

    expect(gateway).toContain("node --input-type=module --eval");
    expect(runtimeCheck).toBeGreaterThan(-1);
    expect(runtimeCheck).toBeLessThan(promotion);
  });

  it("bootstraps an owner only through the restricted gateway and only for a provisioned user", async () => {
    const gateway = await readFile(gatewayPath, "utf8");

    expect(gateway).toContain("^bootstrap-admin\\ ([0-9a-f-]{36})$");
    expect(gateway).toContain('test -f "/var/lib/aibrain/data/users/${user_id}/user.json"');
    expect(gateway).toContain("test -e /var/lib/aibrain/data/workspace-admin/state.json");
    expect(gateway).toContain('grep -qx "AIBRAIN_RUNTIME_ENV_FILE=${runtime_env}" "$ACTIVE_ENV"');
    expect(gateway).toContain('print "AIBRAIN_ADMIN_USER_IDS=" user_id');
    expect(gateway).toContain("--force-recreate app");
  });

  it("is idempotent only for a matching final package and removes failed staging evidence", async () => {
    const gateway = await readFile(gatewayPath, "utf8");
    expect(gateway).toContain('validate_existing_release_readbacks "$revision" "$run_id" "$evidence_root"');
    expect(gateway).toContain('ARNALL_READBACKS_ALREADY_COLLECTED revision=%s run_id=%s');
    expect(gateway).toContain('ciRunId:$runId');
    expect(gateway).toContain("existing acceptance evidence does not match the requested retry");
    expect(gateway).toContain("trap cleanup_readback_staging EXIT");
    expect(gateway).toContain('rm -rf --one-file-system -- "$readback_staging"');
    expect(gateway).toContain('chmod 0700 "$readback_staging"');
    expect(gateway).toContain('readback_revision=""\n  trap - EXIT');
    expect(gateway.indexOf('if [[ -e "$evidence_root" ]]; then')).toBeLessThan(gateway.indexOf('readback_staging="$(mktemp -d'));
  });

  it("removes a failed readback staging directory without losing cleanup scope", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-readback-cleanup-"));
    const revision = "a".repeat(40);
    const staging = path.join(root, `.${revision}.fixture`);
    try {
      const gateway = await readFile(gatewayPath, "utf8");
      const script = path.join(root, "cleanup.sh");
      const sourceable = gateway.replace(/\nmain "\$@"\n$/u, "\n");
      await writeFile(script, `${sourceable}\nrm() { if [[ "\${1:-}" == "-rf" && "\${2:-}" == "--one-file-system" && "\${3:-}" == "--" ]]; then command rm -rf -- "$4"; else command rm "$@"; fi; }\nreadback_evidence_parent="$1"\nreadback_revision="${revision}"\nreadback_staging="$1/.${revision}.fixture"\nmkdir -p "$readback_staging"\ntrap cleanup_readback_staging EXIT\nfalse\n`, { mode: 0o700 });

      expect(() => execFileSync("bash", [script, root], { stdio: "pipe" })).toThrow();
      expect(existsSync(staging)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ships a JavaScript collector generated exactly from the reviewed TypeScript source", async () => {
    const [source, runtime] = await Promise.all([
      readFile(path.join(process.cwd(), "scripts", "collect-release-readbacks.ts"), "utf8"),
      readFile(path.join(process.cwd(), "scripts", "collect-release-readbacks.mjs"), "utf8"),
    ]);
    const generated = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        esModuleInterop: true,
      },
    }).outputText;

    expect(runtime).toBe(generated);
  });
});
