import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const manager = path.join(process.cwd(), "scripts/manage-release.mjs");
const digestA = `registry.example.test/aibrain@sha256:${"a".repeat(64)}`;
const digestB = `registry.example.test/aibrain@sha256:${"b".repeat(64)}`;
const egressDigestA = `registry.example.test/aibrain-egress@sha256:${"c".repeat(64)}`;
const egressDigestB = `registry.example.test/aibrain-egress@sha256:${"d".repeat(64)}`;
const revisionA = "1".repeat(40);
const revisionB = "2".repeat(40);
const roots: string[] = [];

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "aibrain-release-test-")));
  roots.push(root);
  const envFile = path.join(root, "compose.env");
  const currentComposeFile = path.join(root, "compose-a.yaml");
  const composeFile = path.join(root, "compose-b.yaml");
  const activeConfigFile = path.join(root, "installation-active.json");
  const installationConfig = path.join(root, "installation-b.json");
  const installationConfigC = path.join(root, "installation-c.json");
  const stateFile = path.join(root, "release.json");
  const dockerBin = path.join(root, "docker-fake.mjs");
  const logFile = path.join(root, "docker.log");
  const runtimeFile = path.join(root, "runtime.json");
  await writeFile(envFile, [
    "AIBRAIN_INSTALLATION_ID=company-qa",
    "AIBRAIN_COMPOSE_PROJECT_NAME=aibrain-company-qa",
    `AIBRAIN_IMAGE=${digestA}`,
    `AIBRAIN_EGRESS_IMAGE=${egressDigestA}`,
    `AIBRAIN_REVISION=${revisionA}`,
    `AIBRAIN_INSTALLATION_CONFIG_HOST=${activeConfigFile}`,
    "",
  ].join("\n"));
  await writeFile(currentComposeFile, "services:\n  app:\n    image: ${AIBRAIN_IMAGE}\n    mem_limit: 1g\n  egress-gateway:\n    image: ${AIBRAIN_EGRESS_IMAGE}\n");
  await writeFile(composeFile, "services:\n  app:\n    image: ${AIBRAIN_IMAGE}\n    mem_limit: 2g\n  egress-gateway:\n    image: ${AIBRAIN_EGRESS_IMAGE}\n");
  await writeFile(activeConfigFile, '{"schemaVersion":1,"brand":"A"}\n');
  await writeFile(installationConfig, '{"schemaVersion":1,"brand":"B"}\n');
  await writeFile(installationConfigC, '{"schemaVersion":1,"brand":"C"}\n');
  await writeFile(runtimeFile, JSON.stringify({ app: digestA, egress: egressDigestA }));
  await writeFile(dockerBin, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + "\\n");
if (process.env.FAKE_DELAY_MS) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_DELAY_MS));
}
if (process.env.FAKE_HANG_MATCH && JSON.stringify(args).includes(process.env.FAKE_HANG_MATCH)) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
}
if (process.env.FAKE_KILL_PARENT_ON && JSON.stringify(args).includes(process.env.FAKE_KILL_PARENT_ON)) {
  process.kill(process.ppid, "SIGKILL");
}
const images = JSON.parse(process.env.FAKE_IMAGE_REVISIONS);
if (args[0] === "image" && args[1] === "inspect") {
  const image = args.at(-1);
  if (!images[image]) process.exit(2);
  if (args[3].includes("RepoDigests")) process.stdout.write(JSON.stringify([image]));
  else process.stdout.write(images[image]);
} else if (args[0] === "compose") {
  const envFile = args[args.indexOf("--env-file") + 1];
  const image = readFileSync(envFile, "utf8").match(/^AIBRAIN_IMAGE=(.+)$/m)?.[1];
  const egressImage = readFileSync(envFile, "utf8").match(/^AIBRAIN_EGRESS_IMAGE=(.+)$/m)?.[1];
  if (args.includes("up") && (image === process.env.FAKE_FAIL_IMAGE || egressImage === process.env.FAKE_FAIL_IMAGE)) {
    if (process.env.FAKE_MUTATE_ENV_ON_FAIL === "1") {
      const { appendFileSync: append } = await import("node:fs");
      append(envFile, "EXTERNAL_CHANGE=preserve\\n");
    }
    process.exit(3);
  }
  if (args.includes("up")) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.FAKE_RUNTIME_FILE, JSON.stringify({ app: image, egress: egressImage }));
  }
  if (args.includes("ps")) process.stdout.write(args.at(-1) === "app" ? "a".repeat(64) : args.at(-1) === "alert-dispatcher" ? "d".repeat(64) : "c".repeat(64));
} else if (args[0] === "inspect") {
  const runtime = JSON.parse(readFileSync(process.env.FAKE_RUNTIME_FILE, "utf8"));
  const isApp = args.at(-1)?.startsWith("a") || args.at(-1)?.startsWith("d");
  const image = isApp ? runtime.app : runtime.egress;
  if (args[2].includes("Health.Status")) process.stdout.write("healthy");
  else if (args[2].includes("Config.Image")) {
    process.stdout.write(process.env.FAKE_MISMATCH_TARGET === "1" && image === ${JSON.stringify(digestB)} ? ${JSON.stringify(digestA)} : image);
  } else if (args[2].includes("org.opencontainers.image.revision")) process.stdout.write(images[image]);
  else process.exit(5);
} else {
  process.exit(4);
}
`);
  await chmod(dockerBin, 0o755);
  await mkdir(path.dirname(stateFile), { recursive: true });
  return {
    root,
    envFile,
    composeFile,
    currentComposeFile,
    activeConfigFile,
    installationConfig,
    installationConfigC,
    stateFile,
    dockerBin,
    logFile,
    runtimeFile,
  };
}

function commandArgs(files: Awaited<ReturnType<typeof fixture>>, command: "promote" | "rollback") {
  return [
    manager,
    command,
    ...(command === "promote" ? [
      "--image", digestB,
      "--egress-image", egressDigestB,
      "--revision", revisionB,
      "--compose-file", files.composeFile,
      "--current-compose-file", files.currentComposeFile,
      "--installation-config", files.installationConfig,
    ] : []),
    "--installation-id", "company-qa",
    "--env-file", files.envFile,
    "--state-file", files.stateFile,
    "--docker-bin", files.dockerBin,
    "--health-timeout-ms", "5000",
    "--docker-command-timeout-ms", "1000",
  ];
}

function environment(files: Awaited<ReturnType<typeof fixture>>, failImage = "") {
  return {
    ...process.env,
    FAKE_DOCKER_LOG: files.logFile,
    FAKE_COMPOSE_ENV: files.envFile,
    FAKE_RUNTIME_FILE: files.runtimeFile,
    FAKE_FAIL_IMAGE: failImage,
    FAKE_IMAGE_REVISIONS: JSON.stringify({
      [digestA]: revisionA,
      [egressDigestA]: revisionA,
      [digestB]: revisionB,
      [egressDigestB]: revisionB,
    }),
  };
}

async function canonicalStateFile(files: Awaited<ReturnType<typeof fixture>>) {
  return path.join(await realpath(path.dirname(files.stateFile)), path.basename(files.stateFile));
}

async function processStartId(pid: number) {
  if (process.platform === "linux") {
    const processStat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = processStat.slice(processStat.lastIndexOf(")") + 2).trim().split(/\s+/u);
    const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
    return sha256(`linux:${bootId}:${fields[19]}`);
  }
  const started = await execFileAsync("/bin/ps", ["-p", String(pid), "-o", "lstart="]);
  return sha256(`darwin:${started.stdout.trim()}`);
}

async function writeLock(files: Awaited<ReturnType<typeof fixture>>, pid: number, startId?: string) {
  await writeFile(`${files.stateFile}.lock`, `${JSON.stringify({
    schemaVersion: 1,
    installationId: "company-qa",
    stateFileHash: sha256(await canonicalStateFile(files)),
    pid,
    processStartId: startId ?? "0".repeat(64),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("immutable release manager", () => {
  it("promotes and rolls back exact image digests with durable state", async () => {
    const files = await fixture();
    const promoted = await execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    });
    expect(JSON.parse(promoted.stdout)).toMatchObject({
      schemaVersion: 3,
      installationId: "company-qa",
      current: { image: digestB, egressImage: egressDigestB, revision: revisionB },
      previous: { image: digestA, egressImage: egressDigestA, revision: revisionA },
    });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestB}`);
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_EGRESS_IMAGE=${egressDigestB}`);
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_REVISION=${revisionB}`);
    expect(await readFile(files.activeConfigFile, "utf8")).toContain('"brand":"B"');
    expect(await readFile(`${files.stateFile}.active.compose.yaml`, "utf8")).toContain("mem_limit: 2g");

    const rolledBack = await execFileAsync(process.execPath, commandArgs(files, "rollback"), {
      env: environment(files),
    });
    expect(JSON.parse(rolledBack.stdout)).toMatchObject({
      current: { image: digestA, egressImage: egressDigestA, revision: revisionA },
      previous: { image: digestB, egressImage: egressDigestB, revision: revisionB },
    });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestA}`);
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_EGRESS_IMAGE=${egressDigestA}`);
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_REVISION=${revisionA}`);
    expect(await readFile(files.activeConfigFile, "utf8")).toContain('"brand":"A"');
    expect(await readFile(`${files.stateFile}.active.compose.yaml`, "utf8")).toContain("mem_limit: 1g");
    const log = await readFile(files.logFile, "utf8");
    expect(log).toContain('"config","--quiet"');
    expect(log).toContain('"up","-d","--force-recreate","--no-deps","egress-gateway","app","alert-dispatcher"');
    expect(log).toContain('"{{.State.Health.Status}}"');
  }, 20_000);

  it("automatically restores the previous healthy image after a failed promotion", async () => {
    const files = await fixture();
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files, digestB),
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("RELEASE_RECOVERED"),
    });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestA}`);
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_EGRESS_IMAGE=${egressDigestA}`);
    expect(await readFile(files.activeConfigFile, "utf8")).toContain('"brand":"A"');
    expect(await readFile(`${files.stateFile}.active.compose.yaml`, "utf8")).toContain("mem_limit: 1g");
    await expect(readFile(files.stateFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const log = (await readFile(files.logFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(log.filter((args) => args.includes("up"))).toHaveLength(2);
  });

  it("restores both images when the egress gateway promotion fails", async () => {
    const files = await fixture();
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files, egressDigestB),
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("RELEASE_RECOVERED"),
    });
    const env = await readFile(files.envFile, "utf8");
    expect(env).toContain(`AIBRAIN_IMAGE=${digestA}`);
    expect(env).toContain(`AIBRAIN_EGRESS_IMAGE=${egressDigestA}`);
    await expect(readFile(files.stateFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed instead of overwriting an unrelated environment change during recovery", async () => {
    const files = await fixture();
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: { ...environment(files, digestB), FAKE_MUTATE_ENV_ON_FAIL: "1" },
    })).rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_TRANSACTION_DRIFT") });
    const env = await readFile(files.envFile, "utf8");
    expect(env).toContain(`AIBRAIN_IMAGE=${digestB}`);
    expect(env).toContain("EXTERNAL_CHANGE=preserve");
    await expect(stat(`${files.stateFile}.transaction.json`)).resolves.toMatchObject({ mode: expect.any(Number) });
  });

  it("promotes and rolls back a config-only release with the same images", async () => {
    const files = await fixture();
    await execFileAsync(process.execPath, commandArgs(files, "promote"), { env: environment(files) });
    const args = commandArgs(files, "promote");
    args[args.indexOf("--installation-config") + 1] = files.installationConfigC;
    await execFileAsync(process.execPath, args, { env: environment(files) });
    expect(await readFile(files.activeConfigFile, "utf8")).toContain('"brand":"C"');
    const log = await readFile(files.logFile, "utf8");
    expect(log).toContain('"--force-recreate"');

    await execFileAsync(process.execPath, commandArgs(files, "rollback"), { env: environment(files) });
    expect(await readFile(files.activeConfigFile, "utf8")).toContain('"brand":"B"');
  }, 20_000);

  it("rejects unsafe or drifting release inputs before Docker mutation", async () => {
    const secret = await fixture();
    await writeFile(secret.envFile, `${await readFile(secret.envFile, "utf8")}AIBRAIN_SESSION_SECRET=must-not-be-versioned\n`);
    await expect(execFileAsync(process.execPath, commandArgs(secret, "promote"), { env: environment(secret) }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_ENV_SECRET") });
    await expect(readFile(secret.logFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const linked = await fixture();
    await link(linked.composeFile, path.join(linked.root, "compose-hardlink.yaml"));
    await expect(execFileAsync(process.execPath, commandArgs(linked, "promote"), { env: environment(linked) }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_PATH_INVALID") });
    await expect(readFile(linked.logFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const exposed = await fixture();
    await chmod(exposed.composeFile, 0o666);
    await expect(execFileAsync(process.execPath, commandArgs(exposed, "promote"), { env: environment(exposed) }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_PATH_INVALID") });

    const redirected = await fixture();
    const original = `${redirected.composeFile}.original`;
    await (await import("node:fs/promises")).rename(redirected.composeFile, original);
    await symlink(original, redirected.composeFile);
    await expect(execFileAsync(process.execPath, commandArgs(redirected, "promote"), { env: environment(redirected) }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_PATH_INVALID") });

    const drifted = await fixture();
    await execFileAsync(process.execPath, commandArgs(drifted, "promote"), { env: environment(drifted) });
    const before = (await readFile(drifted.logFile, "utf8")).split("\n").length;
    await writeFile(drifted.activeConfigFile, '{"schemaVersion":1,"brand":"tampered"}\n');
    await expect(execFileAsync(process.execPath, commandArgs(drifted, "rollback"), { env: environment(drifted) }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_INPUT_DRIFT") });
    expect((await readFile(drifted.logFile, "utf8")).split("\n").length).toBe(before);
  }, 20_000);

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
    await writeLock(files, process.pid, await processStartId(process.pid));
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("RELEASE_LOCKED"),
    });
    await expect(readFile(files.logFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers a lock whose exact owner process has exited", async () => {
    const files = await fixture();
    const dead = await execFileAsync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
    await writeLock(files, Number(dead.stdout));
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    })).resolves.toMatchObject({ stdout: expect.stringContaining(digestB) });
    await expect(stat(`${files.stateFile}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers a reused PID when its process start identity differs", async () => {
    const files = await fixture();
    await writeLock(files, process.pid, "f".repeat(64));
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    })).resolves.toMatchObject({ stdout: expect.stringContaining(digestB) });
  });

  it("serializes two reclaimers of the same dead owner with an OS advisory lock", async () => {
    const files = await fixture();
    const dead = await execFileAsync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
    await writeLock(files, Number(dead.stdout));
    const run = () => execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: { ...environment(files), FAKE_DELAY_MS: "20" },
    });
    const results = await Promise.allSettled([run(), run()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { stderr: expect.stringContaining("RELEASE_LOCKED") } });
    expect(JSON.parse(await readFile(files.stateFile, "utf8"))).toMatchObject({ current: { image: digestB } });
  });

  it("bounds a hung Docker subprocess before any release mutation", async () => {
    const files = await fixture();
    const args = commandArgs(files, "promote");
    args[args.indexOf("--docker-command-timeout-ms") + 1] = "100";
    const started = Date.now();
    await expect(execFileAsync(process.execPath, args, {
      env: { ...environment(files), FAKE_HANG_MATCH: '\"image\",\"inspect\"' },
    })).rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_DOCKER_TIMEOUT") });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestA}`);
    await expect(stat(`${files.stateFile}.transaction.json`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a healthy container with the wrong image and restores both previous services", async () => {
    const files = await fixture();
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: { ...environment(files), FAKE_MISMATCH_TARGET: "1" },
    })).rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_RECOVERED") });
    expect(JSON.parse(await readFile(files.runtimeFile, "utf8"))).toEqual({ app: digestA, egress: egressDigestA });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestA}`);
    await expect(stat(`${files.stateFile}.transaction.json`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects current runtime drift before creating a transaction", async () => {
    const files = await fixture();
    await writeFile(files.runtimeFile, JSON.stringify({ app: digestB, egress: egressDigestA }));
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    })).rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_RUNNING_IMAGE_MISMATCH") });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestA}`);
    await expect(stat(`${files.stateFile}.transaction.json`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a false current revision in durable state before rollback", async () => {
    const files = await fixture();
    await execFileAsync(process.execPath, commandArgs(files, "promote"), { env: environment(files) });
    const state = JSON.parse(await readFile(files.stateFile, "utf8"));
    state.current.revision = revisionA;
    await writeFile(files.stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await expect(execFileAsync(process.execPath, commandArgs(files, "rollback"), {
      env: environment(files),
    })).rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_STATE_INVALID") });
    await expect(stat(`${files.stateFile}.transaction.json`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("verifies both previous image labels before rollback mutates Compose", async () => {
    const files = await fixture();
    await execFileAsync(process.execPath, commandArgs(files, "promote"), { env: environment(files) });
    const env = environment(files);
    env.FAKE_IMAGE_REVISIONS = JSON.stringify({
      [digestA]: revisionA,
      [egressDigestA]: revisionB,
      [digestB]: revisionB,
      [egressDigestB]: revisionB,
    });
    await expect(execFileAsync(process.execPath, commandArgs(files, "rollback"), { env }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_IMAGE_REVISION_MISMATCH") });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestB}`);
    await expect(stat(`${files.stateFile}.transaction.json`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers an abrupt process death after selecting the target environment", async () => {
    const files = await fixture();
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: { ...environment(files), FAKE_KILL_PARENT_ON: '\"up\"' },
    })).rejects.toMatchObject({ code: expect.any(Number) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestB}`);
    expect(JSON.parse(await readFile(files.runtimeFile, "utf8"))).toEqual({ app: digestB, egress: egressDigestB });
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    })).rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_INTERRUPTED_RECOVERED") });
    expect(await readFile(files.envFile, "utf8")).toContain(`AIBRAIN_IMAGE=${digestA}`);
    expect(JSON.parse(await readFile(files.runtimeFile, "utf8"))).toEqual({ app: digestA, egress: egressDigestA });
    await expect(stat(`${files.stateFile}.transaction.json`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${files.stateFile}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finishes a target known healthy when the process died before committing state", async () => {
    const files = await fixture();
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: { ...environment(files), FAKE_KILL_PARENT_ON: '\"up\"' },
    })).rejects.toMatchObject({ code: expect.any(Number) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const transactionPath = `${files.stateFile}.transaction.json`;
    const transaction = JSON.parse(await readFile(transactionPath, "utf8"));
    await writeFile(transactionPath, `${JSON.stringify({
      ...transaction,
      phase: "target-healthy",
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    })).rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_NO_CHANGE") });
    expect(JSON.parse(await readFile(files.stateFile, "utf8"))).toMatchObject({
      current: { image: digestB, egressImage: egressDigestB, revision: revisionB },
      previous: { image: digestA, egressImage: egressDigestA, revision: revisionA },
    });
    expect(JSON.parse(await readFile(files.runtimeFile, "utf8"))).toEqual({ app: digestB, egress: egressDigestB });
    await expect(stat(transactionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${files.stateFile}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finishes cleanup after rollback state committed but the process died", async () => {
    const files = await fixture();
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: { ...environment(files), FAKE_KILL_PARENT_ON: '\"up\"' },
    })).rejects.toMatchObject({ code: expect.any(Number) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const transactionPath = `${files.stateFile}.transaction.json`;
    const transaction = JSON.parse(await readFile(transactionPath, "utf8"));
    await writeFile(files.envFile, Buffer.from(transaction.current.environment, "base64").toString("utf8"));
    await writeFile(files.activeConfigFile, Buffer.from(transaction.current.installationConfig, "base64").toString("utf8"));
    await writeFile(`${files.stateFile}.active.compose.yaml`, Buffer.from(transaction.current.compose, "base64").toString("utf8"));
    await writeFile(files.runtimeFile, JSON.stringify({ app: digestA, egress: egressDigestA }));
    await writeFile(files.stateFile, `${JSON.stringify(transaction.recoveryState, null, 2)}\n`, { mode: 0o600 });
    await writeFile(transactionPath, `${JSON.stringify({
      ...transaction,
      phase: "recovery-state-committed",
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    await expect(execFileAsync(process.execPath, commandArgs(files, "promote"), {
      env: environment(files),
    })).rejects.toMatchObject({ stderr: expect.stringContaining("RELEASE_INTERRUPTED_RECOVERED") });
    expect(JSON.parse(await readFile(files.stateFile, "utf8"))).toMatchObject({
      current: { image: digestA },
      previous: { image: digestB },
    });
    await expect(stat(transactionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${files.stateFile}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
