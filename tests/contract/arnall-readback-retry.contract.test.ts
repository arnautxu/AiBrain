import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const revision = "a".repeat(40);
const backendCiRunId = "33165012869";
const publishRunId = "33165012870";
const deployRunId = "33165012871";
const capturedAt = "2026-08-28T10:05:00.000Z";
const appDigest = `sha256:${"b".repeat(64)}`;
const gatewayDigest = `sha256:${"c".repeat(64)}`;

function document(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function firstCollectionFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aibrain-readback-retry-"));
  roots.push(root);
  const artifacts = new Map<string, string>([
    ["release-ci-readback.json", document({
      schemaVersion: 1, kind: "aibrain-release-ci-readback", source: "ci", candidateSha: revision, ciSha: revision,
      backendCi: { runId: backendCiRunId, headSha: revision }, publish: { runId: publishRunId, headSha: revision },
      deploy: { runId: deployRunId, headSha: revision }, appOciDigest: appDigest, gatewayOciDigest: gatewayDigest,
      capturedAt, provenance: { kind: "file", sha256: "d".repeat(64) },
    })],
    ["release-deploy-state.json", document({ schemaVersion: 1, kind: "aibrain-release-deploy-state-readback", source: "deploy-state", ciSha: revision, deploySha: revision, appOciDigest: appDigest, gatewayOciDigest: gatewayDigest, capturedAt })],
    ["release-runtime-readback.json", document({ schemaVersion: 1, kind: "aibrain-release-runtime-readback", source: "runtime", deploySha: revision, runtimeSha: revision, appOciRevision: revision, gatewayOciRevision: revision, capturedAt })],
    ["release-app-oci-inspect.json", document({ schemaVersion: 1, kind: "aibrain-release-oci-inspect", source: "oci-inspect", component: "app", revision, digest: appDigest, capturedAt })],
    ["release-gateway-oci-inspect.json", document({ schemaVersion: 1, kind: "aibrain-release-oci-inspect", source: "oci-inspect", component: "gateway", revision, digest: gatewayDigest, capturedAt })],
  ]);
  for (const [name, value] of artifacts) await writeFile(path.join(root, name), value, { mode: 0o600 });
  await writeFile(path.join(root, "release-pipeline-source.json"), document({
    schemaVersion: 2,
    headSha: revision,
    backendCi: { workflow: "Backend CI", conclusion: "success", headSha: revision, runId: backendCiRunId },
    publish: { workflow: "Publish GHCR images", conclusion: "success", headSha: revision, runId: publishRunId },
    deploy: { workflow: "Deploy Arnall", headSha: revision, runId: deployRunId },
    images: { appDigest, gatewayDigest },
  }), { mode: 0o600 });
  const manifest = {
    schemaVersion: 2, releaseSha: revision, backendCiRunId, publishRunId, deployRunId,
    appOciDigest: appDigest, gatewayOciDigest: gatewayDigest, capturedAt,
    evidence: [
      ["release:ci-readback", "release-ci-readback.json"], ["release:deploy-state", "release-deploy-state.json"],
      ["release:runtime-readback", "release-runtime-readback.json"], ["release:app-oci-inspect", "release-app-oci-inspect.json"],
      ["release:gateway-oci-inspect", "release-gateway-oci-inspect.json"],
    ].map(([route, artifactPath]) => ({ kind: "release", route, artifactPath, sha256: sha256(artifacts.get(artifactPath)!) })),
  };
  await writeFile(path.join(root, "acceptance-release-readbacks.json"), document(manifest), { mode: 0o600 });
  return root;
}

async function retryValidator(): Promise<string> {
  const gateway = await readFile(path.join(process.cwd(), "infra/hetzner/app/deploy-arnall-main.sh"), "utf8");
  const sourceable = gateway.replace(/\nmain "\$@"\n$/u, "\n");
  const script = await mkdtemp(path.join(os.tmpdir(), "aibrain-readback-validator-"));
  roots.push(script);
  const pathname = path.join(script, "validate.sh");
  await writeFile(pathname, `${sourceable}\nfail() { return 1; }\nrequire_root_owned_file() { [[ -f "$1" && ! -L "$1" ]]; }\nrequire_root_owned_directory() { [[ -d "$1" && ! -L "$1" ]]; }\nvalidate_existing_release_readbacks "$1" "$2" "$3" "$4" "$5" "$6" "$7"\n`, { mode: 0o700 });
  await chmod(pathname, 0o700);
  return pathname;
}

function validate(script: string, root: string, requestedBackendCiRunId = backendCiRunId): void {
  execFileSync("bash", [
    script,
    revision,
    requestedBackendCiRunId,
    publishRunId,
    deployRunId,
    appDigest,
    gatewayDigest,
    root,
  ], { stdio: "pipe" });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Arnall release-readback retry contract", () => {
  it("accepts the exact package from a first collection, then rejects a different run ID", async () => {
    const [root, script] = await Promise.all([firstCollectionFixture(), retryValidator()]);

    expect(() => validate(script, root)).not.toThrow();
    expect(() => validate(script, root, "33165012872")).toThrow();
  });

  it("rejects a changed artifact even when the final directory already exists", async () => {
    const [root, script] = await Promise.all([firstCollectionFixture(), retryValidator()]);

    await writeFile(path.join(root, "release-app-oci-inspect.json"), `${document({ schemaVersion: 1, kind: "aibrain-release-oci-inspect", source: "oci-inspect", component: "app", revision, digest: appDigest, capturedAt })}\n`, { mode: 0o600 });
    expect(() => validate(script, root)).toThrow();
  });
});
