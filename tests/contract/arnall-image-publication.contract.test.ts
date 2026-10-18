import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Workflow = { jobs: Record<string, { steps: { name: string; run?: string; if?: string }[] }> };
const yaml = createRequire(import.meta.url)("js-yaml") as { load(source: string): Workflow };
const sha = "a".repeat(40);
const app = `ghcr.io/arnautxu/aibrain@sha256:${"b".repeat(64)}`;
const gateway = `ghcr.io/arnautxu/aibrain-egress@sha256:${"c".repeat(64)}`;

describe("Arnall tested-image publication", () => {
  it.each([
    ["valid exact-source Arnau pair", { schemaVersion: 1, revision: sha, image: app, egressImage: gateway }, true],
    ["different source revision", { schemaVersion: 1, revision: "d".repeat(40), image: app, egressImage: gateway }, false],
    ["foreign application owner", { schemaVersion: 1, revision: sha, image: app.replace("arnautxu", "foreign"), egressImage: gateway }, false],
    ["foreign gateway owner", { schemaVersion: 1, revision: sha, image: app, egressImage: gateway.replace("arnautxu", "foreign") }, false],
    ["mutable application tag", { schemaVersion: 1, revision: sha, image: "ghcr.io/arnautxu/aibrain:main", egressImage: gateway }, false],
    ["missing gateway", { schemaVersion: 1, revision: sha, image: app }, false],
    ["wrong schema", { schemaVersion: 2, revision: sha, image: app, egressImage: gateway }, false],
  ])("executes the actual manifest gate: %s", async (_name, manifest, accepted) => {
    const workflow = yaml.load(await readFile(".github/workflows/publish-ghcr.yml", "utf8"));
    const script = workflow.jobs.publish.steps.find((step) => step.name === "Require the same source and both Arnau image repositories")?.run;
    expect(script).toBeTruthy();
    const root = await mkdtemp(path.join(os.tmpdir(), "arnall-publish-"));
    try {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(root, "tested-images")));
      const original = `${JSON.stringify(manifest)}\n`;
      await writeFile(path.join(root, "tested-images/release.json"), original);
      const result = spawnSync("bash", ["-euo", "pipefail", "-c", script!], {
        cwd: root,
        env: { ...process.env, RUNNER_TEMP: root, RELEASE_SHA: sha, CI_RUN_ID: "10000001", PUBLICATION_RUN_ID: "10000002" },
      });
      expect(result.error).toBeUndefined();
      expect(result.status === 0, result.stderr.toString()).toBe(accepted);
      if (accepted) {
        expect(await readFile(path.join(root, "release.json"), "utf8")).toBe(original);
        expect(JSON.parse(await readFile(path.join(root, "publication.json"), "utf8"))).toEqual({
          revision: sha, validationRunId: "10000001", publicationRunId: "10000002", rebuild: false,
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a linked manifest before publication", async () => {
    const workflow = yaml.load(await readFile(".github/workflows/publish-ghcr.yml", "utf8"));
    const script = workflow.jobs.publish.steps.find((step) => step.name === "Require the same source and both Arnau image repositories")!.run!;
    const root = await mkdtemp(path.join(os.tmpdir(), "arnall-linked-manifest-"));
    try {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(root, "tested-images")));
      await writeFile(path.join(root, "original.json"), JSON.stringify({ schemaVersion: 1, revision: sha, image: app, egressImage: gateway }));
      await symlink(path.join(root, "original.json"), path.join(root, "tested-images/release.json"));
      const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], { cwd: root, env: { ...process.env, RUNNER_TEMP: root, RELEASE_SHA: sha } });
      expect(result.status).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
