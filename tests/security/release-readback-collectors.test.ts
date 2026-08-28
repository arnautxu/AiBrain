import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectReleaseReadbacks, type CommandAdapter } from "../../scripts/collect-release-readbacks";

const roots: string[] = [];
const candidateSha = "a".repeat(40);
const appImage = `registry.example.test/aibrain@sha256:${"b".repeat(64)}`;
const gatewayImage = `registry.example.test/aibrain-gateway@sha256:${"c".repeat(64)}`;

function commandAdapter(overrides: Partial<{ appRevision: string; gatewayRevision: string; appImage: string; gatewayImage: string }> = {}): CommandAdapter {
  return {
    run: async (args) => {
      const target = args.at(-1);
      const app = target === "a".repeat(12) || target === appImage;
      const image = app ? (overrides.appImage ?? appImage) : (overrides.gatewayImage ?? gatewayImage);
      if (args.includes("{{.Config.Image}}")) return image;
      if (args.some((arg) => arg.includes("org.opencontainers.image.revision"))) {
        return app ? (overrides.appRevision ?? candidateSha) : (overrides.gatewayRevision ?? candidateSha);
      }
      if (args.includes("{{json .RepoDigests}}")) return JSON.stringify([image]);
      throw new Error(`Unexpected Docker command: ${args.join(" ")}`);
    },
  };
}

async function fixture(options: { ciSha?: string; includeCi?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-release-readbacks-"));
  roots.push(root);
  await mkdir(path.join(root, "sources"), { recursive: true, mode: 0o700 });
  const ciSourcePath = path.join(root, "sources", "backend-ci.json");
  const releaseStatePath = path.join(root, "sources", "release-state.json");
  if (options.includeCi !== false) {
    await writeFile(ciSourcePath, `${JSON.stringify({ schemaVersion: 1, workflow: "Backend CI", conclusion: "success", headSha: options.ciSha ?? candidateSha, runId: "33165012869" })}\n`, { mode: 0o600 });
  }
  await writeFile(releaseStatePath, `${JSON.stringify({ schemaVersion: 3, current: { revision: candidateSha, image: appImage, egressImage: gatewayImage } })}\n`, { mode: 0o600 });
  return { ciSourcePath, releaseStatePath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release readback collectors", () => {
  it("produces five separately typed, correlated artifacts from source files and Docker inspections", async () => {
    const files = await fixture();
    const readbacks = await collectReleaseReadbacks({
      candidateSha,
      ...files,
      appContainer: "a".repeat(12),
      gatewayContainer: "b".repeat(12),
      capturedAt: "2026-08-28T10:05:00.000Z",
      command: commandAdapter(),
    });
    expect(readbacks.map(({ route }) => route)).toEqual([
      "release:ci-readback", "release:deploy-state", "release:runtime-readback", "release:app-oci-inspect", "release:gateway-oci-inspect",
    ]);
    expect(readbacks.map(({ artifactPath }) => artifactPath)).toEqual([
      "release-ci-readback.json", "release-deploy-state.json", "release-runtime-readback.json", "release-app-oci-inspect.json", "release-gateway-oci-inspect.json",
    ]);
    for (const { value } of readbacks) {
      expect(value).toMatchObject({ capturedAt: "2026-08-28T10:05:00.000Z", provenance: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) } });
    }
  });

  it("fails when the independent CI source is absent or does not match the candidate", async () => {
    const absent = await fixture({ includeCi: false });
    await expect(collectReleaseReadbacks({
      candidateSha, ...absent, appContainer: "a".repeat(12), gatewayContainer: "b".repeat(12), command: commandAdapter(),
    })).rejects.toThrow(/CI source/u);

    const mismatch = await fixture({ ciSha: "d".repeat(40) });
    await expect(collectReleaseReadbacks({
      candidateSha, ...mismatch, appContainer: "a".repeat(12), gatewayContainer: "b".repeat(12), command: commandAdapter(),
    })).rejects.toThrow("CI source SHA does not match the requested candidate.");
  });

  it("fails when runtime or OCI command readback disagrees with deploy state", async () => {
    const files = await fixture();
    await expect(collectReleaseReadbacks({
      candidateSha, ...files, appContainer: "a".repeat(12), gatewayContainer: "b".repeat(12),
      command: commandAdapter({ appRevision: "e".repeat(40) }),
    })).rejects.toThrow("Running container image or revision does not match release state.");
  });
});
