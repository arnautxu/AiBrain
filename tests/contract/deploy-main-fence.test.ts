import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const gateway = readFileSync(path.join(process.cwd(), "infra/hetzner/app/deploy-arnall-main.sh"), "utf8");
const functions = gateway.slice(0, gateway.lastIndexOf('\nmain "$@"'));
const revision = "a".repeat(40);

function check(remote: string, failure = false) {
  // Only exercise the pure remote fence. No network, files, Docker or host mutation.
  return spawnSync("bash", ["-c", `${functions}\n
curl() { ${failure ? "return 22" : `printf '%s' '${JSON.stringify({ object: { sha: remote } })}'`}; }
verify_current_main '${revision}' 'ephemeral_test_token'
printf 'verified'
`], { encoding: "utf8" });
}

describe("host main promotion fence", () => {
  it("accepts the exact current main", () => {
    const result = check(revision);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("verified");
  });

  it("refuses a superseded candidate without logging the token", () => {
    const result = check("b".repeat(40));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("candidate superseded");
    expect(result.stdout + result.stderr).not.toContain("ephemeral_test_token");
  });

  it("fails closed when GitHub cannot be read", () => {
    const result = check(revision, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot verify current GitHub main");
  });

  it("checks main again after both pulls while holding the host lock", () => {
    const pull = gateway.slice(gateway.indexOf("pull_ghcr_images()"), gateway.indexOf("is_aibrain_image_reference()"));
    expect(pull.match(/verify_current_main "\$revision" "\$ghcr_token"/gu)).toHaveLength(2);
    expect(pull.lastIndexOf("verify_current_main")).toBeGreaterThan(pull.indexOf('pull "$egress_image"'));
    const promote = gateway.slice(gateway.indexOf("deploy_ghcr_release()"), gateway.indexOf("validate_existing_release_readbacks()"));
    expect(promote.indexOf("flock --exclusive")).toBeLessThan(promote.indexOf('pull_ghcr_images "$app_image"'));
    expect(promote.indexOf('pull_ghcr_images "$app_image"')).toBeLessThan(promote.indexOf('replace_release_values "$ACTIVE_ENV"'));
  });
});
