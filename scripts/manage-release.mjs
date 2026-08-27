#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{7,64}$/u;
const INSTALLATION = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const RELEASE_SCHEMA_VERSION = 1;

class ReleaseError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ReleaseError";
    this.code = code;
  }
}

function usage() {
  return [
    "Usage:",
    "  node scripts/manage-release.mjs promote --image <name@sha256:...> --revision <git-sha> --installation-id <slug> --env-file <absolute> --compose-file <absolute> --state-file <absolute>",
    "  node scripts/manage-release.mjs rollback --installation-id <slug> --env-file <absolute> --compose-file <absolute> --state-file <absolute>",
    "Optional: --docker-bin <absolute> --health-timeout-ms <positive integer>",
  ].join("\n");
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["promote", "rollback"]).has(command)) {
    throw new ReleaseError("RELEASE_USAGE", usage());
  }
  if (rest.length % 2 !== 0) throw new ReleaseError("RELEASE_USAGE", usage());
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith("--") || !value || values.has(name)) {
      throw new ReleaseError("RELEASE_USAGE", usage());
    }
    values.set(name, value);
  }
  const allowed = new Set([
    "--image",
    "--revision",
    "--installation-id",
    "--env-file",
    "--compose-file",
    "--state-file",
    "--docker-bin",
    "--health-timeout-ms",
  ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new ReleaseError("RELEASE_USAGE", `Unknown option ${name}.`);
  }
  const required = ["--installation-id", "--env-file", "--compose-file", "--state-file"];
  if (command === "promote") required.push("--image", "--revision");
  for (const name of required) {
    if (!values.has(name)) throw new ReleaseError("RELEASE_USAGE", `Missing ${name}.`);
  }
  const installationId = values.get("--installation-id");
  if (!INSTALLATION.test(installationId)) {
    throw new ReleaseError("RELEASE_INSTALLATION_INVALID", "Installation ID is invalid.");
  }
  const image = values.get("--image") ?? null;
  const revision = values.get("--revision") ?? null;
  if (image !== null && !IMAGE.test(image)) {
    throw new ReleaseError("RELEASE_IMAGE_MUTABLE", "Release images must use an immutable sha256 digest.");
  }
  if (revision !== null && !REVISION.test(revision)) {
    throw new ReleaseError("RELEASE_REVISION_INVALID", "Release revision must be a hexadecimal git commit.");
  }
  const timeoutValue = values.get("--health-timeout-ms") ?? "120000";
  if (!POSITIVE_INTEGER.test(timeoutValue) || Number(timeoutValue) > 900_000) {
    throw new ReleaseError("RELEASE_TIMEOUT_INVALID", "Health timeout must be between 1 and 900000 ms.");
  }
  return {
    command,
    installationId,
    image,
    revision,
    envFile: safeExistingFile(values.get("--env-file"), "compose env"),
    composeFile: safeExistingFile(values.get("--compose-file"), "Compose"),
    stateFile: safeStateFile(values.get("--state-file")),
    dockerBin: safeExecutable(values.get("--docker-bin") ?? "/usr/bin/docker"),
    healthTimeoutMs: Number(timeoutValue),
  };
}

function safeExistingFile(value, label) {
  if (!path.isAbsolute(value)) throw new ReleaseError("RELEASE_PATH_INVALID", `${label} path must be absolute.`);
  const canonical = realpathSync(value);
  const metadata = lstatSync(canonical);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new ReleaseError("RELEASE_PATH_INVALID", `${label} path must be a regular file.`);
  }
  return canonical;
}

function safeStateFile(value) {
  if (!path.isAbsolute(value)) throw new ReleaseError("RELEASE_PATH_INVALID", "State path must be absolute.");
  const parent = realpathSync(path.dirname(value));
  const resolved = path.join(parent, path.basename(value));
  if (existsSync(resolved)) {
    const metadata = lstatSync(resolved);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new ReleaseError("RELEASE_STATE_UNSAFE", "Release state must be a private regular file.");
    }
  }
  return resolved;
}

function safeExecutable(value) {
  const executable = safeExistingFile(value, "Docker executable");
  try {
    const descriptor = openSync(executable, constants.O_RDONLY);
    closeSync(descriptor);
  } catch (error) {
    throw new ReleaseError("RELEASE_DOCKER_INVALID", "Docker executable is unavailable.", { cause: error });
  }
  return executable;
}

function parseEnv(contents) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new ReleaseError("RELEASE_ENV_INVALID", "Compose env contains an invalid line.");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || values.has(key)) {
      throw new ReleaseError("RELEASE_ENV_INVALID", "Compose env contains an invalid or duplicate key.");
    }
    values.set(key, value);
  }
  return values;
}

function replaceImage(contents, image) {
  let replacements = 0;
  const updated = contents.replace(/^AIBRAIN_IMAGE=.*$/gmu, () => {
    replacements += 1;
    return `AIBRAIN_IMAGE=${image}`;
  });
  if (replacements !== 1) {
    throw new ReleaseError("RELEASE_ENV_INVALID", "Compose env must contain AIBRAIN_IMAGE exactly once.");
  }
  return updated;
}

function writeAtomic(file, contents, mode = 0o600) {
  const temporary = `${file}.pending-${process.pid}`;
  const descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try {
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
  const parent = openSync(path.dirname(file), constants.O_RDONLY);
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}

function runDocker(options, args) {
  try {
    return execFileSync(options.dockerBin, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new ReleaseError("RELEASE_DOCKER_FAILED", "Docker release command failed.", { cause: error });
  }
}

function inspectImage(options, image, expectedRevision = null) {
  if (!IMAGE.test(image)) throw new ReleaseError("RELEASE_IMAGE_MUTABLE", "Stored release image is not immutable.");
  const digestsText = runDocker(options, ["image", "inspect", "--format", "{{json .RepoDigests}}", image]);
  let digests;
  try {
    digests = JSON.parse(digestsText);
  } catch (error) {
    throw new ReleaseError("RELEASE_IMAGE_INVALID", "Docker returned invalid image digests.", { cause: error });
  }
  const expectedDigest = image.slice(image.indexOf("@sha256:"));
  if (!Array.isArray(digests) || !digests.some((item) => typeof item === "string" && item.endsWith(expectedDigest))) {
    throw new ReleaseError("RELEASE_IMAGE_DIGEST_MISMATCH", "Local image does not match the requested digest.");
  }
  const revision = runDocker(options, [
    "image", "inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.revision\"}}", image,
  ]);
  if (!REVISION.test(revision) || (expectedRevision !== null && revision !== expectedRevision)) {
    throw new ReleaseError("RELEASE_IMAGE_REVISION_MISMATCH", "Image revision label does not match the release.");
  }
  return revision;
}

function composeArgs(options, ...args) {
  return ["compose", "--env-file", options.envFile, "-f", options.composeFile, ...args];
}

function waitUntilHealthy(options) {
  const containerId = runDocker(options, composeArgs(options, "ps", "-q", "app"));
  if (!/^[a-f0-9]{12,64}$/u.test(containerId)) {
    throw new ReleaseError("RELEASE_CONTAINER_INVALID", "Compose did not return the app container ID.");
  }
  const deadline = Date.now() + options.healthTimeoutMs;
  while (Date.now() <= deadline) {
    const health = runDocker(options, ["inspect", "--format", "{{.State.Health.Status}}", containerId]);
    if (health === "healthy") return;
    if (health === "unhealthy") break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(500, options.healthTimeoutMs));
  }
  throw new ReleaseError("RELEASE_HEALTH_FAILED", "App did not become healthy before the release deadline.");
}

function deploy(options) {
  runDocker(options, composeArgs(options, "config", "--quiet"));
  runDocker(options, composeArgs(options, "up", "-d", "--no-deps", "app"));
  waitUntilHealthy(options);
}

function readState(options) {
  if (!existsSync(options.stateFile)) return null;
  let value;
  try {
    value = JSON.parse(readFileSync(options.stateFile, "utf8"));
  } catch (error) {
    throw new ReleaseError("RELEASE_STATE_INVALID", "Release state is invalid JSON.", { cause: error });
  }
  if (value?.schemaVersion !== RELEASE_SCHEMA_VERSION || value.installationId !== options.installationId ||
      !value.current || !IMAGE.test(value.current.image) || !REVISION.test(value.current.revision) ||
      (value.previous !== null && (!IMAGE.test(value.previous?.image) || !REVISION.test(value.previous?.revision)))) {
    throw new ReleaseError("RELEASE_STATE_INVALID", "Release state failed validation.");
  }
  return value;
}

function releaseRecord(image, revision, promotedAt = new Date().toISOString()) {
  return { image, revision, promotedAt };
}

function withReleaseLock(options, operation) {
  const lockFile = `${options.stateFile}.lock`;
  let descriptor;
  try {
    descriptor = openSync(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new ReleaseError(
        "RELEASE_LOCKED",
        "Another release operation owns the lock; verify that process before removing the lock manually.",
      );
    }
    throw new ReleaseError("RELEASE_LOCK_FAILED", "Release lock could not be created.", { cause: error });
  }
  try {
    writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    return operation();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    unlinkSync(lockFile);
    const parent = openSync(path.dirname(lockFile), constants.O_RDONLY);
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  }
}

function executeUnlocked(options) {
  const envContents = readFileSync(options.envFile, "utf8");
  const env = parseEnv(envContents);
  if (env.get("AIBRAIN_INSTALLATION_ID") !== options.installationId) {
    throw new ReleaseError("RELEASE_INSTALLATION_MISMATCH", "Compose env belongs to another installation.");
  }
  const composeProject = env.get("AIBRAIN_COMPOSE_PROJECT_NAME");
  if (!composeProject || !composeProject.includes(options.installationId)) {
    throw new ReleaseError("RELEASE_PROJECT_MISMATCH", "Compose project does not identify the installation.");
  }
  const currentImage = env.get("AIBRAIN_IMAGE");
  if (!currentImage || !IMAGE.test(currentImage)) {
    throw new ReleaseError("RELEASE_IMAGE_MUTABLE", "Current Compose image must already use an immutable digest.");
  }
  const state = readState(options);
  if (options.command === "rollback" && state?.current.image !== currentImage) {
    throw new ReleaseError(
      "RELEASE_STATE_DRIFT",
      "Compose image does not match the current durable release state.",
    );
  }
  const currentRevision = inspectImage(options, currentImage);
  const current = state?.current?.image === currentImage
    ? state.current
    : releaseRecord(currentImage, currentRevision);
  const target = options.command === "promote"
    ? releaseRecord(options.image, inspectImage(options, options.image, options.revision))
    : state?.previous;
  if (!target) throw new ReleaseError("RELEASE_ROLLBACK_UNAVAILABLE", "No previous release is recorded.");
  if (target.image === currentImage) {
    throw new ReleaseError("RELEASE_NO_CHANGE", "Target release is already current.");
  }
  writeAtomic(options.envFile, replaceImage(envContents, target.image));
  try {
    deploy(options);
  } catch (error) {
    writeAtomic(options.envFile, envContents);
    try {
      deploy(options);
    } catch (rollbackError) {
      throw new ReleaseError(
        "RELEASE_AND_RECOVERY_FAILED",
        "Release failed and the previous image could not be recovered automatically.",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    throw new ReleaseError("RELEASE_RECOVERED", "Release failed; the previous image was restored and is healthy.", { cause: error });
  }
  const nextState = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    installationId: options.installationId,
    composeProject,
    updatedAt: new Date().toISOString(),
    current: target,
    previous: current,
  };
  writeAtomic(options.stateFile, `${JSON.stringify(nextState, null, 2)}\n`);
  return nextState;
}

function execute(options) {
  return withReleaseLock(options, () => executeUnlocked(options));
}

export { ReleaseError, execute, parseArguments };

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  try {
    const result = execute(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof ReleaseError ? error.code : "RELEASE_FAILED";
    const message = error instanceof Error ? error.message : "Release failed.";
    process.stderr.write(`${code}: ${message}\n`);
    process.exitCode = 1;
  }
}
