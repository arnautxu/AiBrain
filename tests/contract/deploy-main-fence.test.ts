import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
verify_current_main '${revision}'
printf 'verified'
`], { encoding: "utf8" });
}

describe("host main promotion fence", () => {
  it("stages only Arnall branding without changing current release inputs", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "arnall-branding-gate-"));
    try {
      const source = path.join(directory, "source.json");
      const target = path.join(directory, "target.json");
      const original = { companySlug: "arnall", branding: { productName: "Arnall AI", logoPath: "/branding/aibrain/logo.svg", faviconPath: "/branding/aibrain/favicon.svg", accentColor: "#315ee7" }, connectors: { retained: true } };
      writeFileSync(source, JSON.stringify(original));
      const result = spawnSync("bash", ["-c", `${functions}\nprepare_arnall_branding_config "$1" "$2"`, "test", source, target], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(source, "utf8"))).toEqual(original);
      expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ ...original, branding: { ...original.branding, logoPath: "/branding/arnall/logo.jpg", faviconPath: "/branding/arnall/logo.jpg" } });
      const newer = { ...original, branding: { ...original.branding, logoPath: "/branding/arnall/newer.svg", faviconPath: "/branding/arnall/newer.ico" } };
      writeFileSync(source, JSON.stringify(newer));
      expect(spawnSync("bash", ["-c", `${functions}\nprepare_arnall_branding_config "$1" "$2"`, "test", source, target]).status).toBe(0);
      expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(newer);
      writeFileSync(source, JSON.stringify({ ...original, companySlug: "another-client" }));
      expect(spawnSync("bash", ["-c", `${functions}\nprepare_arnall_branding_config "$1" "$2"`, "test", source, target]).status).not.toBe(0);
      const promote = gateway.slice(gateway.indexOf("deploy_ghcr_release()"), gateway.indexOf("validate_existing_release_readbacks()"));
      expect(promote).toContain('--installation-config "$target_config"');
      expect(promote).not.toContain('--installation-config "$ACTIVE_CONFIG"');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("accepts the exact current main", () => {
    const result = check(revision);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("verified");
  });

  it("refuses a superseded candidate without requiring a deployment token", () => {
    const result = check("b".repeat(40));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("candidate superseded");
    expect(gateway.slice(gateway.indexOf("verify_current_main()"), gateway.indexOf("pull_ghcr_images()"))).not.toContain("Authorization:");
  });

  it("fails closed when GitHub cannot be read", () => {
    const result = check(revision, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot verify current GitHub main");
  });

  it("checks main again after both pulls while holding the host lock", () => {
    const pull = gateway.slice(gateway.indexOf("pull_ghcr_images()"), gateway.indexOf("is_aibrain_image_reference()"));
    expect(pull.match(/verify_current_main "\$revision"/gu)).toHaveLength(2);
    expect(pull.lastIndexOf("verify_current_main")).toBeGreaterThan(pull.indexOf('pull "$egress_image"'));
    const promote = gateway.slice(gateway.indexOf("deploy_ghcr_release()"), gateway.indexOf("validate_existing_release_readbacks()"));
    expect(promote.indexOf("flock --exclusive")).toBeLessThan(promote.indexOf('pull_ghcr_images "$app_image"'));
    expect(promote.indexOf('pull_ghcr_images "$app_image"')).toBeLessThan(promote.indexOf('replace_release_values "$ACTIVE_ENV"'));
  });
});
