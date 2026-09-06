import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflowPath = path.join(process.cwd(), ".github", "workflows", "backend-ci.yml");
type Job = {
  name: string;
  needs?: string | string[];
  if?: string;
  "continue-on-error"?: boolean;
  strategy?: { "fail-fast": boolean; matrix: { shard?: number[]; include?: { command: string }[] } };
  steps: { run?: string; if?: string; "continue-on-error"?: boolean; env?: Record<string, string>; with?: Record<string, unknown> }[];
};
const yaml = createRequire(import.meta.url)("js-yaml") as { load(source: string): { jobs: Record<string, Job> } };

async function readJobs() {
  return yaml.load(await readFile(workflowPath, "utf8")).jobs;
}

describe("backend CI contract", () => {
  it("runs three complete Vitest shards independently of the non-test quality checks", async () => {
    const jobs = await readJobs();
    const build = jobs["quality-build"];
    const tests = jobs["quality-tests"];
    expect(tests.strategy).toEqual({ "fail-fast": false, matrix: { shard: [1, 2, 3] } });
    expect(tests.steps.filter((step) => step.run?.startsWith("npm test"))).toEqual([
      { name: "Unit, integration and contract test shard", run: "npm test -- --shard=${{ matrix.shard }}/3" },
    ]);
    for (const job of [build, tests]) {
      expect(job.needs).toBeUndefined();
      expect(job.if).toBeUndefined();
      expect(job["continue-on-error"]).toBeUndefined();
      expect(job.steps.every((step) => !step.if && !step["continue-on-error"])).toBe(true);
      expect(job.steps.some((step) => step.run === "npm ci")).toBe(true);
      expect(job.steps.some((step) => step.with?.cache === "npm" && step.with["cache-dependency-path"] === "package-lock.json")).toBe(true);
    }
    const commands = build.steps.map((step) => step.run ?? "").join("\n");
    for (const command of ["npm run contracts:verify", "npm run typecheck", "npm run lint", "test_rdp*.py", "test_knowledge*.py", "--require-hashes", "npm run build:automation-worker", "npm run build", "npm run infra:validate", "bash -n infra/hetzner/app/deploy-arnall-main.sh"]) {
      expect(commands).toContain(command);
    }
    expect(commands).not.toContain("npm test");
  });

  it("retains the required check and fails closed for every non-success dependency result", async () => {
    const gate = (await readJobs()).quality;
    expect(gate.name).toBe("Types, lint, contracts, tests and build");
    expect(gate.needs).toEqual(["quality-build", "quality-tests"]);
    expect(gate.if).toBe("always()");
    expect(gate["continue-on-error"]).toBeUndefined();
    expect(gate.steps).toHaveLength(1);
    const step = gate.steps[0];
    expect(step.if).toBeUndefined();
    expect(step["continue-on-error"]).toBeUndefined();
    expect(step.env).toEqual({ BUILD_RESULT: "${{ needs.quality-build.result }}", TESTS_RESULT: "${{ needs.quality-tests.result }}" });
    expect(step.run).toBeTruthy();
    for (const build of ["success", "failure", "cancelled", "skipped", ""]) {
      for (const tests of ["success", "failure", "cancelled", "skipped", ""]) {
        const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run!], {
          env: { ...process.env, BUILD_RESULT: build, TESTS_RESULT: tests },
        });
        expect(result.error).toBeUndefined();
        expect(result.status === 0, `build=${build}, tests=${tests}`).toBe(build === "success" && tests === "success");
      }
    }
  });

  it("preserves the independent E2E partition and publication caches", async () => {
    const jobs = await readJobs();
    expect(jobs["e2e-suites"].needs).toBeUndefined();
    expect(jobs["e2e-suites"].strategy?.["fail-fast"]).toBe(false);
    expect(jobs["e2e-suites"].strategy?.matrix.include?.map((entry) => entry.command)).toEqual([
      "npm run test:e2e:backend",
      "npx playwright test --project=chromium-desktop --shard=1/2",
      "npx playwright test --project=chromium-desktop --shard=2/2",
      "npx playwright test --project=webkit-iphone",
    ]);
    expect(jobs.e2e.needs).toBe("e2e-suites");
    expect(jobs.e2e.if).toBe("always()");
    const publish = await readFile(path.join(process.cwd(), ".github/workflows/publish-ghcr.yml"), "utf8");
    expect(publish).toContain("cache-from:");
    expect(publish).toContain("cache-to:");
    expect(publish).toContain(":buildcache");
  });

  it("keeps every required deterministic gate in the protected workflow", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    for (const command of [
      "npm ci",
      "npm run contracts:verify",
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run test:e2e",
      "npm run build",
      "npm run infra:validate",
      "npm run test:documents:real",
      "docker compose",
      "--target runtime",
      "--target egress-gateway",
      "--no-cache",
    ]) {
      expect(workflow, `missing CI gate: ${command}`).toContain(command);
    }
    expect(workflow).not.toContain("npm audit");
    expect(workflow).toContain("node-version: 24.18.1");
    expect(workflow).toMatch(/permissions:\n\s+contents: read/u);
  });

  it("pins actions and does not grant CI a secret-bearing trigger", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((value) => /@[0-9a-f]{40}$/u.test(value))).toBe(true);
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toMatch(/contents:\s*write/u);
    expect(workflow).not.toMatch(/persist-credentials:\s*true/u);
  });

  it("publishes only after the protected gates and deploys the immutable GHCR digests", async () => {
    const publish = await readFile(path.join(process.cwd(), ".github", "workflows", "publish-ghcr.yml"), "utf8");
    const workflow = await readFile(path.join(process.cwd(), ".github", "workflows", "deploy-arnall.yml"), "utf8");
    const deploy = workflow.indexOf('root@"$DEPLOY_HOST" "deploy-ghcr $TESTED_SHA $APP_IMAGE $EGRESS_IMAGE $GHCR_USERNAME"');
    const collection = workflow.indexOf("Collect post-deploy release identity readbacks");

    expect(publish).toContain("Backend CI");
    expect(publish).toContain("packages: write");
    expect(publish).toContain("docker/build-push-action@");
    expect(publish).toContain("AIBRAIN_REVISION=${{ github.event.workflow_run.head_sha }}");
    expect(publish).toContain("aibrain-ghcr-release-${{ github.event.workflow_run.head_sha }}");
    expect(deploy).toBeGreaterThan(-1);
    expect(collection).toBeGreaterThan(deploy);
    expect(workflow).toContain("Publish GHCR images");
    expect(workflow).toContain("packages: read");
    expect(workflow).toContain("GHCR_PULL_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("actions/download-artifact@");
    expect(workflow).toContain("Resolve and verify the real Backend CI run");
    expect(workflow).toContain('actions/workflows/backend-ci.yml/runs');
    expect(workflow).toContain('.name == "Backend CI"');
    expect(workflow).toContain('.name == "Publish GHCR images"');
    expect(workflow).toContain("BACKEND_CI_RUN_ID: ${{ steps.pipeline.outputs.backend_ci_run_id }}");
    expect(workflow).toContain("PUBLISH_RUN_ID: ${{ github.event.workflow_run.id }}");
    expect(workflow).toContain("DEPLOY_RUN_ID: ${{ github.run_id }}");
    expect(workflow).toContain('root@"$DEPLOY_HOST" "collect-readbacks $TESTED_SHA $BACKEND_CI_RUN_ID $PUBLISH_RUN_ID $DEPLOY_RUN_ID $APP_DIGEST $EGRESS_DIGEST" > /dev/null');
    expect(workflow).toContain('root@"$DEPLOY_HOST" "bootstrap-admin $BOOTSTRAP_ADMIN_USER_ID"');
    expect(workflow).toContain("vars.ARNALL_BOOTSTRAP_ADMIN_USER_ID != ''");
    expect(workflow).toContain("[[ \"$TESTED_SHA\" =~ ^[0-9a-f]{40}$ ]]");
    expect(workflow).toContain("[[ \"$BACKEND_CI_RUN_ID\" =~ ^[0-9]{6,20}$ ]]");
    expect(workflow).not.toContain("CI_RUN_ID: ${{ github.event.workflow_run.id }}");
  });
});
