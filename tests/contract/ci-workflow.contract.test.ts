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

  it("collects readbacks only after the successful restricted deploy using trusted workflow context", async () => {
    const workflow = await readFile(path.join(process.cwd(), ".github", "workflows", "deploy-arnall.yml"), "utf8");
    const deploy = workflow.indexOf('root@"$DEPLOY_HOST" "deploy $TESTED_SHA"');
    const collection = workflow.indexOf("Collect post-deploy release identity readbacks");

    expect(deploy).toBeGreaterThan(-1);
    expect(collection).toBeGreaterThan(deploy);
    expect(workflow).toContain("CI_RUN_ID: ${{ github.event.workflow_run.id }}");
    expect(workflow).toContain('root@"$DEPLOY_HOST" "collect-readbacks $TESTED_SHA $CI_RUN_ID" > /dev/null');
    expect(workflow).toContain('root@"$DEPLOY_HOST" "bootstrap-admin $BOOTSTRAP_ADMIN_USER_ID"');
    expect(workflow).toContain("vars.ARNALL_BOOTSTRAP_ADMIN_USER_ID != ''");
    expect(workflow).toContain("[[ \"$TESTED_SHA\" =~ ^[0-9a-f]{40}$ ]]");
    expect(workflow).toContain("[[ \"$CI_RUN_ID\" =~ ^[0-9]{6,20}$ ]]");
  });
});
