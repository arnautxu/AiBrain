import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const gatewayPath = path.join(process.cwd(), "infra", "hetzner", "app", "deploy-arnall-main.sh");
const oldDigest = "a".repeat(64);
const currentDigest = "b".repeat(64);
const oldImage = `ghcr.io/arnautxu/aibrain@sha256:${oldDigest}`;
const currentImage = `ghcr.io/arnautxu/aibrain@sha256:${currentDigest}`;
const imageId = `sha256:${"c".repeat(64)}`;
const currentImageId = `sha256:${"e".repeat(64)}`;
const containerId = "d".repeat(64);

type Fixture = {
  containers?: string;
  containerDetails?: string;
  references?: string;
  repeat?: boolean;
  hasPrevious?: boolean;
  usePreviousCleanup?: boolean;
  useInactiveCleanup?: boolean;
  currentSharesImageId?: boolean;
  inventory?: string;
};

async function runCleanup(fixture: Fixture): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aibrain-image-cleanup-"));
  roots.push(root);
  const state = path.join(root, "release-state.json");
  const log = path.join(root, "docker.log");
  const releaseState = {
    current: { image: currentImage, egressImage: `ghcr.io/arnautxu/aibrain-egress@sha256:${currentDigest}` },
    ...(fixture.hasPrevious === false ? {} : { previous: { image: oldImage } }),
  };
  await writeFile(state, `${JSON.stringify(releaseState)}\n`, { mode: 0o600 });
  const gateway = await readFile(gatewayPath, "utf8");
  const sourceable = gateway
    .replace(/readonly STATE_FILE="[^"]+"/u, `readonly STATE_FILE="${state}"`)
    .replace(/\nmain "\$@"\n$/u, "\n");
  const script = path.join(root, "cleanup.sh");
  const references = fixture.references ?? `${oldImage}\n`;
  const inventory = fixture.inventory ?? `${oldImage}\n${currentImage}\n`;
  const containers = fixture.containers ?? "";
  const details = fixture.containerDetails ?? "";
  await writeFile(script, `#!/usr/bin/env bash
set -euo pipefail
present=1
containers="$(printf '%b' ${JSON.stringify(containers)})"$'\n'
references="$(printf '%b' ${JSON.stringify(references)})"$'\n'
fixture_details=${JSON.stringify(details)}
inventory=${JSON.stringify(inventory)}
log=${JSON.stringify(log)}
docker() {
  if [[ "$1 $2" == "image ls" ]]; then
    printf '%b' "$inventory"
    return 0
  fi
  if [[ "$1 $2" == "image inspect" ]]; then
    if [[ "$*" == *'{{.Id}}'* ]]; then
      if [[ "$*" == *${currentDigest}* ]]; then
        printf '%s\\n' ${JSON.stringify(fixture.currentSharesImageId ? imageId : currentImageId)}
      elif [[ "$present" == 1 ]]; then
        printf '%s\\n' ${JSON.stringify(imageId)}
      fi
      return 0
    fi
    if [[ "$*" == *'org.opencontainers.image.title'* ]]; then
      printf '%s\\n' 'AiBrain Company Brain'
      return 0
    fi
    if [[ "$*" == *'range .RepoTags'* ]]; then
      printf '%s' "$references"
      return 0
    fi
    if [[ "$present" == 1 ]]; then
      return 0
    fi
    return 1
  fi
  if [[ "$1 $2" == "ps --all" ]]; then
    printf '%s' "$containers"
    return 0
  fi
  if [[ "$1 $2" == "container inspect" ]]; then
    printf '%s\\n' "$fixture_details"
    return 0
  fi
  if [[ "$1 $2" == "container rm" ]]; then
    printf 'container-rm %s\\n' "$3" >> "$log"
    containers=""
    return 0
  fi
  if [[ "$1 $2" == "image rm" ]]; then
    printf 'image-rm %s\\n' "$3" >> "$log"
    present=0
    return 0
  fi
  printf 'unexpected docker invocation: %s\\n' "$*" >&2
  return 64
}
${sourceable}
set +e
${fixture.useInactiveCleanup ? "cleanup_inactive_aibrain_images" : fixture.usePreviousCleanup ? "cleanup_previous_aibrain_images" : `remove_unused_aibrain_image ${JSON.stringify(oldImage)}`}
${fixture.repeat ? `remove_unused_aibrain_image ${JSON.stringify(oldImage)}` : ""}
cleanup_status=$?
set -e
printf 'cleanup-status=%s\\n' "$cleanup_status"
`, { mode: 0o700 });
  try {
    return execFileSync("bash", ["-c", "bash \"$1\" 2>&1", "bash", script], { encoding: "utf8" })
      + await readFile(log, "utf8").catch(() => "");
  } catch (error) {
    const output = error instanceof Error && "stdout" in error ? String(error.stdout) : "";
    throw new Error(`cleanup fixture failed:\n${output}`, { cause: error });
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Arnall single-release image cleanup contract", () => {
  it("does nothing for an initial deployment with no previous release", async () => {
    const output = await runCleanup({ hasPrevious: false, usePreviousCleanup: true });

    expect(output).not.toContain("container-rm");
    expect(output).not.toContain("image-rm");
  });

  it("removes every inactive AiBrain digest even when it is older than previous", async () => {
    const output = await runCleanup({ hasPrevious: false, useInactiveCleanup: true });

    expect(output).toContain(`ARNALL_RELEASE_CLEANUP_REMOVED_IMAGE image=${oldImage} image_id=${imageId}`);
    expect(output).toContain(`image-rm ${oldImage}`);
    expect(output).not.toContain(`image-rm ${currentImage}`);
  });

  it("removes only an obsolete stopped container in this installation, then its prior image", async () => {
    const output = await runCleanup({
      containers: `${containerId}\n`,
      containerDetails: `false|${imageId}|aibrain-company-qa`,
    });

    expect(output).toContain(`ARNALL_RELEASE_CLEANUP_REMOVED_CONTAINER image=${oldImage} container=${containerId}`);
    expect(output).toContain(`ARNALL_RELEASE_CLEANUP_REMOVED_IMAGE image=${oldImage} image_id=${imageId}`);
    expect(output).toContain(`container-rm ${containerId}`);
    expect(output).toContain(`image-rm ${oldImage}`);
  });

  it("leaves a shared image untouched and reports the exact foreign reference", async () => {
    const output = await runCleanup({ references: `${oldImage}\nexample.test/other-workload:stable\n` });

    expect(output).toContain("reason=shared-image-reference detail=reference=example.test/other-workload:stable");
    expect(output).toContain("cleanup-status=1");
    expect(output).not.toContain("image-rm");
    expect(output).not.toContain("container-rm");
  });

  it("does not untag a current digest when Docker resolves it to the same image ID", async () => {
    const output = await runCleanup({ currentSharesImageId: true });

    expect(output).toContain(`reason=current-image-id detail=image_id=${imageId}`);
    expect(output).toContain("cleanup-status=1");
    expect(output).not.toContain("image-rm");
  });

  it("leaves a running or foreign-project container untouched", async () => {
    const output = await runCleanup({
      containers: `${containerId}\n`,
      containerDetails: `true|${imageId}|another-compose-project`,
    });

    expect(output).toContain(`reason=container-reference detail=container=${containerId},running=true,image=${imageId},project=another-compose-project`);
    expect(output).toContain("cleanup-status=1");
    expect(output).not.toContain("image-rm");
    expect(output).not.toContain("container-rm");
  });

  it("is idempotent once the stale image and its stopped container are gone", async () => {
    const output = await runCleanup({
      containers: `${containerId}\n`,
      containerDetails: `false|${imageId}|aibrain-company-qa`,
      repeat: true,
    });

    expect(output.match(/container-rm/g) ?? []).toHaveLength(1);
    expect(output.match(/image-rm/g) ?? []).toHaveLength(1);
  });

  it("treats digest aliases removed with an earlier reference as already clean", async () => {
    const alias = `ghcr.io/arnautxu/aibrain@sha256:${"f".repeat(64)}`;
    const output = await runCleanup({ references: `${oldImage}\n${alias}\n` });

    expect(output).toContain(`image-rm ${oldImage}`);
    expect(output).not.toContain(`image-rm ${alias}`);
    expect(output).toContain("cleanup-status=0");
    expect(output).not.toContain("reason=image-remove-failed");
  });

  it("does not run cleanup until the promotion and public live/readiness checks have passed", async () => {
    const gateway = await readFile(gatewayPath, "utf8");
    const promotion = gateway.indexOf('node "${OPS_ROOT}/manage-release.mjs"');
    const health = gateway.indexOf("verify_public_health", promotion);
    const cleanup = gateway.lastIndexOf("cleanup_inactive_aibrain_images");

    expect(promotion).toBeGreaterThan(-1);
    expect(health).toBeGreaterThan(promotion);
    expect(cleanup).toBeGreaterThan(health);
    expect(gateway).toContain("/api/health/live");
    expect(gateway).toContain("/api/health/ready");
    expect(gateway).not.toMatch(/docker\s+(?:system|builder|image)\s+prune/u);
    expect(gateway).not.toContain("docker buildx prune");
  });
});
