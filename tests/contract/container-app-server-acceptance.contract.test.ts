import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("production Codex App Server acceptance gate", () => {
  it("packages and runs the real restart probe before readiness can become green", async () => {
    const [dockerfile, entrypoint, workflow, readiness, appArmor] = await Promise.all([
      readFile(path.join(repositoryRoot, "Dockerfile"), "utf8"),
      readFile(path.join(repositoryRoot, "infra/hetzner/app/entrypoint.sh"), "utf8"),
      readFile(path.join(repositoryRoot, ".github/workflows/backend-ci.yml"), "utf8"),
      readFile(path.join(repositoryRoot, "src/operations/runtime-readiness.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "infra/hetzner/apparmor/aibrain-container"), "utf8"),
    ]);

    expect(dockerfile).toContain("npm run build:container-app-server-acceptance");
    expect(dockerfile).toContain("/usr/local/share/aibrain/container-app-server-acceptance.mjs");
    expect(entrypoint).toContain("node /usr/local/share/aibrain/container-app-server-acceptance.mjs");
    expect(entrypoint).toContain("export AIBRAIN_CODEX_APP_SERVER_ACCEPTED=1");
    expect(readiness).toContain('environment.AIBRAIN_CODEX_APP_SERVER_ACCEPTED !== "1"');
    expect(readiness).toContain('unavailable("CODEX_APP_SERVER_ACCEPTANCE_REQUIRED")');
    expect(workflow).toContain("Exercise packaged Codex App Server through its production sandbox");
    expect(workflow).toContain("apparmor_parser -r infra/hetzner/apparmor/aibrain-container");
    expect(workflow).toContain("--security-opt apparmor=aibrain-container");
    expect(workflow).toContain("--read-only");
    expect(workflow).toContain("--cap-drop ALL");
    expect(workflow).toContain("--pids-limit 768");
    expect(workflow).toContain("/usr/local/share/aibrain/container-app-server-acceptance.mjs");
    expect(appArmor).toContain("userns,");
    expect(appArmor).toContain("mount,");
  });
});
