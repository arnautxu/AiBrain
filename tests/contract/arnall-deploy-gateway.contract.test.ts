import { readFile } from "node:fs/promises";
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
});
