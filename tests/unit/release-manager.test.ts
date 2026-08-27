import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const manager = path.join(process.cwd(), "scripts/manage-release.mjs");
const digestA = `registry.example.test/aibrain@sha256:${"a".repeat(64)}`;
const digestB = `registry.example.test/aibrain@sha256:${"b".repeat(64)}`;
const revisionA = "1".repeat(40);
const revisionB = "2".repeat(40);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-release-test-"));
  const envFile = path.join(root, "compose.env");
  const composeFile = path.join(root, "compose.yaml");
  const stateFile = path.join(root, "release.json");
  const dockerBin = path.join(root, "docker-fake.mjs");
  const logFile = path.join(root, "docker.log");
  await writeFile(envFile, [
    "AIBRAIN_INSTALLATION_ID=company-qa",
    "AIBRAIN_COMPOSE_PROJECT_NAME=aibrain-company-qa",
    `AIBRAIN_IMAGE=${digestA}`,
    "",
  ].join("\n"));
  await writeFile(composeFile, "services:\n  app:\n    image: ${AIBRAIN_IMAGE}\n");
  await writeFile(dockerBin, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + "\\n");
const images = JSON.parse(process.env.FAKE_IMAGE_REVISIONS);
if (args[0] === "image" && args[1] === "inspect") {
  const image = args.at(-1);
  if (!images[image]) process.exit(2);
  if (args[3].includes("RepoDigests")) process.stdout.write(JSON.stringify([image]));
  else process.stdout.write(images[image]);
} else if (args[0] === "compose") {
  const envFile = args[args.indexOf("--env-file") + 1];
  const image = readFileSync(envFile, "utf8").match(/^AIBRAIN_IMAGE=(.+)$/m)?.[1];
  if (args.includes("up") && image === process.env.FAKE_FAIL_IMAGE) process.exit(3);
  if (args.includes("ps")) process.stdout.write("a".repeat(64));
} else if (args[0] === "inspect") {
  process.stdout.write("healthy");
} else {
  process.exit(4);
}
`);
  await chmod(dockerBin, 0o755);
  await mkdir(path.dirname(stateFile), { recursive: true });
  return { root, envFile, composeFile, stateFile, dockerBin, logFile };
}

function commandArgs(files: Awaited<ReturnType<typeof fixture>>, command: "promote" | "rollback") {
  return [
    manager,
    command,
    ...(command === "promote" ? ["--image", digestB, "--revision", revisionB] : []),
    "--installation-id", "company-qa",
    "--env-file", files.envFile,
    "--compose-file", files.composeFile,
    "--state-file", files.stateFile,
    "--docker-bin", files.dockerBin,
    "--health-timeout-ms", "1000",
  ];
}

function environment(files: Awaited<ReturnType<typeof fixture>>, failImage = "") {
  return {
    ...process.env,
    FAKE_DOCKER_LOG: files.logFile,
    FAKE_FAIL_IMAGE: failImage,
    FAKE_IMAGE_REVISIONS: JSON.stringify({ [digestA]: revisionA, [digestB]: revisionB }),
  };
}

describe("immutable release manager", () => {
  it("promotes and rolls back exact image digests with durable state", async () => {
    const files = await fixture();
    const promoted = await execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    });
    expect(JSON.parse(promoted.stdout)).toMatchObject({
      schemaVersion: 1,
      installationId: "company-qa",
      current: { image: digestB, revision: revisionB },
      previous: { image: digestA, revision: revisionA },
    });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestB}`);

    const rolledBack = await execFileAsync(process.execPath, commandArgs(files, "rollback"), {
      env: environment(files),
    });
    expect(JSON.parse(rolledBack.stdout)).toMatchObject({
      current: { image: digestA, revision: revisionA },
      previous: { image: digestB, revision: revisionB },
    });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestA}`);
    const log = await readFile(files.logFile, "utf8");
    expect(log).toContain('"config","--quiet"');
    expect(log).toContain('"up","-d","--no-deps","app"');
    expect(log).toContain('"{{.State.Health.Status}}"');
  });

  it("automatically restores the previous healthy image after a failed promotion", async () => {
    const files = await fixture();
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files, digestB),
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("RELEASE_RECOVERED"),
    });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestA}`);
    await expect(readFile(files.stateFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const log = (await readFile(files.logFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(log.filter((args) => args.includes("up"))).toHaveLength(2);
  });

  it("rejects mutable image tags before invoking Docker", async () => {
    const files = await fixture();
    const args = commandArgs(files, "promote");
    args[args.indexOf("--image") + 1] = "registry.example.test/aibrain:latest";
    await expect(execFileAsync(process.execPath, args, { env: environment(files) })).rejects.toMatchObject({
      stderr: expect.stringContaining("RELEASE_IMAGE_MUTABLE"),
    });
    await expect(readFile(files.logFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a concurrent operator lock before invoking Docker", async () => {
    const files = await fixture();
    await writeFile(`${files.stateFile}.lock`, "owned by another release\n", { mode: 0o600 });
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("RELEASE_LOCKED"),
    });
    await expect(readFile(files.logFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
