import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const gatewayPath = path.join(process.cwd(), "infra", "hetzner", "app", "deploy-arnall-main.sh");

describe("Arnall deployment gateway contract", () => {
  it("checks build headroom before preparing a release", async () => {
    const gateway = await readFile(gatewayPath, "utf8");
    const diskCheck = gateway.indexOf('free_bytes="$(df --output=avail -B1 /');
    const prepareRelease = gateway.indexOf('install -d -m 0700 -o root -g root "$release_dir"');

    expect(diskCheck).toBeGreaterThan(-1);
    expect(prepareRelease).toBeGreaterThan(diskCheck);
  });

  it("removes only incomplete non-current releases after a failed attempt", async () => {
    const gateway = await readFile(gatewayPath, "utf8");

    expect(gateway).toContain("trap cleanup_incomplete_release EXIT");
    expect(gateway).toContain("status != 0 && release_prepared == 1");
    expect(gateway).toContain(".current.revision == $revision");
    expect(gateway).toContain('rm -rf --one-file-system -- "$release_dir"');
    expect(gateway).toContain("trap - EXIT");
  });

  it("adds post-deploy readbacks after the former gateway baseline, with separate fail-closed sources", async () => {
    const gateway = await readFile(gatewayPath, "utf8");
    const baseline = execFileSync("git", ["show", "3147b08aa54b42bc85e7fa4788b1534fdc8ba2a1:infra/hetzner/app/deploy-arnall-main.sh"], {
      cwd: process.cwd(), encoding: "utf8",
    });
    const deployment = gateway.indexOf('node "${release_dir}/scripts/manage-release.mjs"');
    const health = gateway.indexOf("/api/health/ready");
    const collection = gateway.indexOf("collect_release_readbacks()");

    expect(baseline).not.toContain("collect_release_readbacks");
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
      "node --experimental-strip-types",
      "docker compose --env-file \"$ACTIVE_ENV\" -f \"$compose_file\" ps -q app",
      "docker compose --env-file \"$ACTIVE_ENV\" -f \"$compose_file\" ps -q ingress-gateway",
    ]) expect(gateway).toContain(required);
    expect(gateway).toMatch(/collect-release-readbacks\.ts[\s\S]*--candidate-sha "\$revision"[\s\S]*--release-state "\$STATE_FILE"/u);
  });
});
