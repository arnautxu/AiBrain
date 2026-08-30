import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = path.join(process.cwd(), ".github", "workflows", "backend-ci.yml");

describe("backend CI contract", () => {
  it("keeps every required local gate in the protected workflow", async () => {
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
      "npm audit --omit=dev --audit-level=critical",
      "npm audit --audit-level=critical",
      "npm run test:documents:real",
      "docker compose",
      "--target runtime",
      "--target egress-gateway",
      "--no-cache",
    ]) {
      expect(workflow, `missing CI gate: ${command}`).toContain(command);
    }
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
