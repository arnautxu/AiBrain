#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

const IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{7,64}$/u;
const INSTALLATION = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const RELEASE_SCHEMA_VERSION = 2;
const TRANSACTION_SCHEMA_VERSION = 1;
const LOCK_SCHEMA_VERSION = 1;
const TRANSACTION_PHASES = new Set([
  "prepared",
  "environment-updated",
  "target-healthy",
  "state-committed",
  "recovering-previous",
  "recovery-state-committed",
]);

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
    "  node scripts/manage-release.mjs promote --image <name@sha256:...> --egress-image <name@sha256:...> --revision <git-sha> --installation-id <slug> --env-file <absolute> --compose-file <absolute> --state-file <absolute>",
    "  node scripts/manage-release.mjs rollback --installation-id <slug> --env-file <absolute> --compose-file <absolute> --state-file <absolute>",
    "Optional: --docker-bin <absolute> --health-timeout-ms <positive integer> --docker-command-timeout-ms <positive integer>",
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
    "--egress-image",
    "--revision",
    "--installation-id",
    "--env-file",
    "--compose-file",
    "--state-file",
    "--docker-bin",
    "--health-timeout-ms",
    "--docker-command-timeout-ms",
  ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new ReleaseError("RELEASE_USAGE", `Unknown option ${name}.`);
  }
  const required = ["--installation-id", "--env-file", "--compose-file", "--state-file"];
  if (command === "promote") required.push("--image", "--egress-image", "--revision");
  for (const name of required) {
    if (!values.has(name)) throw new ReleaseError("RELEASE_USAGE", `Missing ${name}.`);
  }
  const installationId = values.get("--installation-id");
  if (!INSTALLATION.test(installationId)) {
    throw new ReleaseError("RELEASE_INSTALLATION_INVALID", "Installation ID is invalid.");
  }
  const image = values.get("--image") ?? null;
  const egressImage = values.get("--egress-image") ?? null;
  const revision = values.get("--revision") ?? null;
  if (image !== null && !IMAGE.test(image)) {
    throw new ReleaseError("RELEASE_IMAGE_MUTABLE", "Release images must use an immutable sha256 digest.");
  }
  if (egressImage !== null && !IMAGE.test(egressImage)) {
    throw new ReleaseError("RELEASE_IMAGE_MUTABLE", "Egress release images must use an immutable sha256 digest.");
  }
  if (revision !== null && !REVISION.test(revision)) {
    throw new ReleaseError("RELEASE_REVISION_INVALID", "Release revision must be a hexadecimal git commit.");
  }
  const timeoutValue = values.get("--health-timeout-ms") ?? "120000";
  if (!POSITIVE_INTEGER.test(timeoutValue) || Number(timeoutValue) > 900_000) {
    throw new ReleaseError("RELEASE_TIMEOUT_INVALID", "Health timeout must be between 1 and 900000 ms.");
  }
  const commandTimeoutValue = values.get("--docker-command-timeout-ms") ?? "30000";
  if (!POSITIVE_INTEGER.test(commandTimeoutValue) || Number(commandTimeoutValue) > 900_000) {
    throw new ReleaseError("RELEASE_TIMEOUT_INVALID", "Docker command timeout must be between 1 and 900000 ms.");
  }
  return {
    command,
    installationId,
    image,
    egressImage,
    revision,
    envFile: safeExistingFile(values.get("--env-file"), "compose env"),
    composeFile: safeExistingFile(values.get("--compose-file"), "Compose"),
    stateFile: safeStateFile(values.get("--state-file")),
    dockerBin: safeExecutable(values.get("--docker-bin") ?? "/usr/bin/docker"),
    healthTimeoutMs: Number(timeoutValue),
    dockerCommandTimeoutMs: Number(commandTimeoutValue),
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

function replaceImages(contents, images) {
  let appReplacements = 0;
  let egressReplacements = 0;
  const updated = contents
    .replace(/^AIBRAIN_IMAGE=.*$/gmu, () => {
      appReplacements += 1;
      return `AIBRAIN_IMAGE=${images.image}`;
    })
    .replace(/^AIBRAIN_EGRESS_IMAGE=.*$/gmu, () => {
      egressReplacements += 1;
      return `AIBRAIN_EGRESS_IMAGE=${images.egressImage}`;
    });
  if (appReplacements !== 1 || egressReplacements !== 1) {
    throw new ReleaseError("RELEASE_ENV_INVALID", "Compose env must contain both release images exactly once.");
  }
  return updated;
}

function writeAtomic(file, contents, mode = 0o600) {
  const temporary = `${file}.pending-${process.pid}-${randomUUID()}`;
  let committed = false;
  try {
    const descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
    try {
      writeFileSync(descriptor, contents, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, file);
    committed = true;
    fsyncDirectory(path.dirname(file));
  } catch (error) {
    if (!committed && existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // A unique pending file is safer to retain than deleting an uncertain path.
      }
    }
    throw new ReleaseError(
      committed ? "RELEASE_ATOMIC_COMMIT_UNCERTAIN" : "RELEASE_ATOMIC_WRITE_FAILED",
      committed
        ? "Atomic file rename completed but directory durability could not be confirmed."
        : "Atomic file update failed before commit.",
      { cause: error },
    );
  }
}

function fsyncDirectory(directory) {
  const parent = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}

function unlinkDurably(file) {
  if (!existsSync(file)) return;
  unlinkSync(file);
  fsyncDirectory(path.dirname(file));
}

function runDocker(options, args, timeoutMs = options.dockerCommandTimeoutMs) {
  try {
    return execFileSync(options.dockerBin, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    }).trim();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ETIMEDOUT") {
      throw new ReleaseError("RELEASE_DOCKER_TIMEOUT", "Docker release command exceeded its bounded timeout.", { cause: error });
    }
    throw new ReleaseError("RELEASE_DOCKER_FAILED", "Docker release command failed.", { cause: error });
  }
}

function inspectImage(options, image, expectedRevision = null, deadline = null) {
  if (!IMAGE.test(image)) throw new ReleaseError("RELEASE_IMAGE_MUTABLE", "Stored release image is not immutable.");
  const commandTimeout = deadline === null
    ? options.dockerCommandTimeoutMs
    : remainingDockerTimeout(options, deadline);
  const digestsText = runDocker(
    options,
    ["image", "inspect", "--format", "{{json .RepoDigests}}", image],
    commandTimeout,
  );
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
  const revision = runDocker(
    options,
    ["image", "inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.revision\"}}", image],
    deadline === null ? options.dockerCommandTimeoutMs : remainingDockerTimeout(options, deadline),
  );
  if (!REVISION.test(revision) || (expectedRevision !== null && revision !== expectedRevision)) {
    throw new ReleaseError("RELEASE_IMAGE_REVISION_MISMATCH", "Image revision label does not match the release.");
  }
  return revision;
}

function composeArgs(options, ...args) {
  return ["compose", "--env-file", options.envFile, "-f", options.composeFile, ...args];
}

function remainingDockerTimeout(options, deadline) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) {
    throw new ReleaseError("RELEASE_HEALTH_FAILED", "The shared release health deadline expired.");
  }
  return Math.max(1, Math.min(options.dockerCommandTimeoutMs, remaining));
}

function waitUntilHealthy(options, service, deadline) {
  const containerId = runDocker(
    options,
    composeArgs(options, "ps", "-q", service),
    remainingDockerTimeout(options, deadline),
  );
  if (!/^[a-f0-9]{12,64}$/u.test(containerId)) {
    throw new ReleaseError("RELEASE_CONTAINER_INVALID", `Compose did not return the ${service} container ID.`);
  }
  while (performance.now() <= deadline) {
    const health = runDocker(
      options,
      ["inspect", "--format", "{{.State.Health.Status}}", containerId],
      remainingDockerTimeout(options, deadline),
    );
    if (health === "healthy") return;
    if (health === "unhealthy") break;
    const waitMs = Math.min(500, Math.max(0, deadline - performance.now()));
    if (waitMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  }
  throw new ReleaseError("RELEASE_HEALTH_FAILED", `${service} did not become healthy before the release deadline.`);
}

function verifyRunningService(options, service, expectedImage, expectedRevision, deadline) {
  const containerId = runDocker(
    options,
    composeArgs(options, "ps", "-q", service),
    remainingDockerTimeout(options, deadline),
  );
  if (!/^[a-f0-9]{12,64}$/u.test(containerId)) {
    throw new ReleaseError("RELEASE_CONTAINER_INVALID", `Compose did not return the ${service} container ID.`);
  }
  const configuredImage = runDocker(
    options,
    ["inspect", "--format", "{{.Config.Image}}", containerId],
    remainingDockerTimeout(options, deadline),
  );
  if (configuredImage !== expectedImage) {
    throw new ReleaseError("RELEASE_RUNNING_IMAGE_MISMATCH", `${service} is not running the requested immutable image.`);
  }
  const revision = runDocker(
    options,
    ["inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.revision\"}}", containerId],
    remainingDockerTimeout(options, deadline),
  );
  if (revision !== expectedRevision) {
    throw new ReleaseError("RELEASE_RUNNING_REVISION_MISMATCH", `${service} is not running the requested revision.`);
  }
}

function deploy(options, release, deadline = performance.now() + options.healthTimeoutMs) {
  runDocker(options, composeArgs(options, "config", "--quiet"), remainingDockerTimeout(options, deadline));
  runDocker(
    options,
    composeArgs(options, "up", "-d", "--no-deps", "egress-gateway", "app", "alert-dispatcher"),
    remainingDockerTimeout(options, deadline),
  );
  waitUntilHealthy(options, "egress-gateway", deadline);
  waitUntilHealthy(options, "app", deadline);
  waitUntilHealthy(options, "alert-dispatcher", deadline);
  verifyRunningService(options, "egress-gateway", release.egressImage, release.revision, deadline);
  verifyRunningService(options, "app", release.image, release.revision, deadline);
  verifyRunningService(options, "alert-dispatcher", release.image, release.revision, deadline);
}

function verifyCurrentDeployment(options, release, deadline = performance.now() + options.healthTimeoutMs) {
  waitUntilHealthy(options, "egress-gateway", deadline);
  waitUntilHealthy(options, "app", deadline);
  waitUntilHealthy(options, "alert-dispatcher", deadline);
  verifyRunningService(options, "egress-gateway", release.egressImage, release.revision, deadline);
  verifyRunningService(options, "app", release.image, release.revision, deadline);
  verifyRunningService(options, "alert-dispatcher", release.image, release.revision, deadline);
}

function releaseRecord(image, egressImage, revision, promotedAt = new Date().toISOString()) {
  return { image, egressImage, revision, promotedAt };
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function hasExactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function validReleaseRecord(value) {
  return hasExactKeys(value, ["image", "egressImage", "revision", "promotedAt"])
    && IMAGE.test(value.image) && IMAGE.test(value.egressImage)
    && REVISION.test(value.revision) && isIsoDate(value.promotedAt);
}

function validReleaseState(value, installationId) {
  return hasExactKeys(value, [
    "schemaVersion", "installationId", "composeProject", "updatedAt", "current", "previous",
  ])
    && value.schemaVersion === RELEASE_SCHEMA_VERSION
    && value.installationId === installationId
    && typeof value.composeProject === "string"
    && /^[a-z0-9][a-z0-9_-]{1,127}$/u.test(value.composeProject)
    && isIsoDate(value.updatedAt)
    && validReleaseRecord(value.current)
    && (value.previous === null || validReleaseRecord(value.previous));
}

function safeOptionalRegularFile(file, code, label) {
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw new ReleaseError(code, `${label} could not be opened safely.`, { cause: error });
  }
  try {
    const metadata = fstatSync(descriptor);
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.uid !== expectedUid
      || (metadata.mode & 0o077) !== 0 || metadata.size > 256 * 1024) {
      throw new ReleaseError(code, `${label} must be a bounded private owner-controlled file.`);
    }
    const contents = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor);
    if (lockIdentity(metadata) !== lockIdentity(after)) {
      throw new ReleaseError(code, `${label} changed while it was being read.`);
    }
    return contents;
  } finally {
    closeSync(descriptor);
  }
}

function parseJson(contents, code, label) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new ReleaseError(code, `${label} is invalid JSON.`, { cause: error });
  }
}

function readStateSnapshot(options) {
  const contents = safeOptionalRegularFile(options.stateFile, "RELEASE_STATE_UNSAFE", "Release state");
  if (contents === null) return { value: null, hash: null };
  const value = parseJson(contents, "RELEASE_STATE_INVALID", "Release state");
  if (!validReleaseState(value, options.installationId)) {
    throw new ReleaseError("RELEASE_STATE_INVALID", "Release state failed validation.");
  }
  return { value, hash: sha256(contents) };
}

function transactionPath(options) {
  return `${options.stateFile}.transaction.json`;
}

function validTransaction(value, options) {
  return hasExactKeys(value, [
    "schemaVersion", "installationId", "composeProject", "operation", "phase",
    "environmentBeforeHash", "environmentTargetHash", "stateBeforeHash",
    "current", "target", "nextState", "recoveryState", "createdAt", "updatedAt",
  ])
    && value.schemaVersion === TRANSACTION_SCHEMA_VERSION
    && value.installationId === options.installationId
    && typeof value.composeProject === "string"
    && /^[a-z0-9][a-z0-9_-]{1,127}$/u.test(value.composeProject)
    && (value.operation === "promote" || value.operation === "rollback")
    && TRANSACTION_PHASES.has(value.phase)
    && typeof value.environmentBeforeHash === "string" && /^[0-9a-f]{64}$/u.test(value.environmentBeforeHash)
    && typeof value.environmentTargetHash === "string" && /^[0-9a-f]{64}$/u.test(value.environmentTargetHash)
    && (value.stateBeforeHash === null || (typeof value.stateBeforeHash === "string" && /^[0-9a-f]{64}$/u.test(value.stateBeforeHash)))
    && validReleaseRecord(value.current)
    && validReleaseRecord(value.target)
    && validReleaseState(value.nextState, options.installationId)
    && validReleaseRecord(value.nextState.previous)
    && validReleaseState(value.recoveryState, options.installationId)
    && validReleaseRecord(value.recoveryState.previous)
    && value.nextState.composeProject === value.composeProject
    && value.nextState.current.image === value.target.image
    && value.nextState.current.egressImage === value.target.egressImage
    && value.nextState.current.revision === value.target.revision
    && value.nextState.current.promotedAt === value.target.promotedAt
    && value.nextState.previous.image === value.current.image
    && value.nextState.previous.egressImage === value.current.egressImage
    && value.nextState.previous.revision === value.current.revision
    && value.nextState.previous.promotedAt === value.current.promotedAt
    && value.recoveryState.composeProject === value.composeProject
    && value.recoveryState.current.image === value.current.image
    && value.recoveryState.current.egressImage === value.current.egressImage
    && value.recoveryState.current.revision === value.current.revision
    && value.recoveryState.current.promotedAt === value.current.promotedAt
    && value.recoveryState.previous.image === value.target.image
    && value.recoveryState.previous.egressImage === value.target.egressImage
    && value.recoveryState.previous.revision === value.target.revision
    && value.recoveryState.previous.promotedAt === value.target.promotedAt
    && isIsoDate(value.createdAt) && isIsoDate(value.updatedAt);
}

function readTransaction(options) {
  const file = transactionPath(options);
  const contents = safeOptionalRegularFile(file, "RELEASE_TRANSACTION_UNSAFE", "Release transaction");
  if (contents === null) return null;
  const value = parseJson(contents, "RELEASE_TRANSACTION_INVALID", "Release transaction");
  if (!validTransaction(value, options)) {
    throw new ReleaseError("RELEASE_TRANSACTION_INVALID", "Release transaction failed validation.");
  }
  return value;
}

function writeTransaction(options, transaction, phase) {
  const updated = { ...transaction, phase, updatedAt: new Date().toISOString() };
  if (!validTransaction(updated, options)) {
    throw new ReleaseError("RELEASE_TRANSACTION_INVALID", "Release transaction failed validation before write.");
  }
  writeAtomic(transactionPath(options), `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

function releaseIdentityMatches(left, right) {
  return Boolean(left && right
    && left.image === right.image
    && left.egressImage === right.egressImage
    && left.revision === right.revision);
}

function serializedStateHash(state) {
  return sha256(`${JSON.stringify(state, null, 2)}\n`);
}

function environmentForRelease(contents, release, expectedHash, label) {
  const updated = replaceImages(contents, release);
  if (sha256(updated) !== expectedHash) {
    throw new ReleaseError("RELEASE_TRANSACTION_DRIFT", `${label} environment no longer matches the durable transaction.`);
  }
  return updated;
}

function clearTransaction(options) {
  try {
    unlinkDurably(transactionPath(options));
  } catch (error) {
    throw new ReleaseError(
      "RELEASE_COMMITTED_CLEANUP_FAILED",
      "Release environment, runtime and state are coherent, but transaction cleanup failed.",
      { cause: error },
    );
  }
}

function recoverPreviousAfterInterruptedTarget(options, transaction, envContents, targetError, commitRollbackState) {
  transaction = writeTransaction(options, transaction, "recovering-previous");
  const restored = environmentForRelease(envContents, transaction.current, transaction.environmentBeforeHash, "Previous");
  writeAtomic(options.envFile, restored);
  try {
    deploy(options, transaction.current);
  } catch (rollbackError) {
    throw new ReleaseError(
      "RELEASE_AND_RECOVERY_FAILED",
      "Interrupted target is unhealthy and the previous image could not be recovered automatically.",
      { cause: new AggregateError([targetError, rollbackError]) },
    );
  }
  if (commitRollbackState) {
    writeAtomic(options.stateFile, `${JSON.stringify(transaction.recoveryState, null, 2)}\n`);
    transaction = writeTransaction(options, transaction, "recovery-state-committed");
  }
  clearTransaction(options);
  throw new ReleaseError(
    "RELEASE_INTERRUPTED_RECOVERED",
    "Interrupted target was unhealthy; the previous release was restored and is healthy.",
    { cause: targetError },
  );
}

function recoverPendingTransaction(options, envContents, composeProject) {
  let transaction = readTransaction(options);
  if (!transaction) return;
  if (transaction.composeProject !== composeProject) {
    throw new ReleaseError("RELEASE_TRANSACTION_DRIFT", "Pending release transaction belongs to another Compose project.");
  }
  const stateSnapshot = readStateSnapshot(options);
  const environmentHash = sha256(envContents);
  const isBeforeEnvironment = environmentHash === transaction.environmentBeforeHash;
  const isTargetEnvironment = environmentHash === transaction.environmentTargetHash;
  const stateIsBefore = stateSnapshot.hash === transaction.stateBeforeHash;
  const stateIsTarget = stateSnapshot.hash === serializedStateHash(transaction.nextState);
  const stateIsRecovery = stateSnapshot.hash === serializedStateHash(transaction.recoveryState);

  if (stateIsRecovery) {
    if (!isBeforeEnvironment) {
      throw new ReleaseError("RELEASE_TRANSACTION_DRIFT", "Recovered release state and Compose environment disagree.");
    }
    deploy(options, transaction.current);
    clearTransaction(options);
    throw new ReleaseError(
      "RELEASE_INTERRUPTED_RECOVERED",
      "Interrupted rollback state was verified and its previous release is healthy.",
    );
  }

  if (stateIsTarget) {
    if (!isTargetEnvironment) {
      throw new ReleaseError("RELEASE_TRANSACTION_DRIFT", "Committed release state and Compose environment disagree.");
    }
    try {
      deploy(options, transaction.target);
    } catch (error) {
      recoverPreviousAfterInterruptedTarget(options, transaction, envContents, error, true);
    }
    transaction = writeTransaction(options, transaction, "state-committed");
    clearTransaction(options);
    return;
  }

  if (!stateIsBefore) {
    throw new ReleaseError("RELEASE_TRANSACTION_DRIFT", "Release state changed during an interrupted transaction.");
  }

  if (transaction.phase === "target-healthy") {
    if (!isTargetEnvironment) {
      throw new ReleaseError("RELEASE_TRANSACTION_DRIFT", "Healthy transaction target is not selected in Compose.");
    }
    try {
      deploy(options, transaction.target);
    } catch (error) {
      recoverPreviousAfterInterruptedTarget(options, transaction, envContents, error, false);
    }
    writeAtomic(options.stateFile, `${JSON.stringify(transaction.nextState, null, 2)}\n`);
    transaction = writeTransaction(options, transaction, "state-committed");
    clearTransaction(options);
    return;
  }

  if (transaction.phase === "state-committed") {
    throw new ReleaseError("RELEASE_TRANSACTION_DRIFT", "Committed transaction is missing its matching release state.");
  }

  if (!isBeforeEnvironment && !isTargetEnvironment) {
    throw new ReleaseError("RELEASE_TRANSACTION_DRIFT", "Compose environment changed during an interrupted transaction.");
  }
  if (transaction.phase === "prepared" && isBeforeEnvironment) {
    clearTransaction(options);
    return;
  }

  transaction = writeTransaction(options, transaction, "recovering-previous");
  const restored = environmentForRelease(envContents, transaction.current, transaction.environmentBeforeHash, "Previous");
  if (!isBeforeEnvironment) writeAtomic(options.envFile, restored);
  deploy(options, transaction.current);
  clearTransaction(options);
  throw new ReleaseError(
    "RELEASE_INTERRUPTED_RECOVERED",
    "An interrupted release was recovered to the previous healthy images; retry the requested operation.",
  );
}

function lockIdentity(metadata) {
  return [metadata.dev, metadata.ino, metadata.size, metadata.mtimeMs, metadata.ctimeMs].join(":");
}

function sameFileObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ESRCH") return false;
      if (error.code === "EPERM") return true;
    }
    throw new ReleaseError("RELEASE_LOCK_FAILED", "Release lock owner could not be verified.", { cause: error });
  }
}

function processStartIdentity(pid) {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const end = stat.lastIndexOf(")");
      const fields = end >= 0 ? stat.slice(end + 2).trim().split(/\s+/u) : [];
      const startTicks = fields[19];
      const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      return startTicks && /^[0-9]+$/u.test(startTicks) && /^[0-9a-f-]{36}$/u.test(bootId)
        ? sha256(`linux:${bootId}:${startTicks}`)
        : null;
    }
    if (process.platform === "darwin") {
      const started = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1_000,
      }).trim();
      return started ? sha256(`darwin:${started}`) : null;
    }
    return null;
  } catch (error) {
    if (error && typeof error === "object" && (("code" in error && error.code === "ENOENT")
      || ("status" in error && error.status === 1))) return null;
    throw new ReleaseError("RELEASE_LOCK_FAILED", "Release process start identity could not be read.", { cause: error });
  }
}

function recoverOrRejectLock(options, lockFile) {
  let metadata = lstatSync(lockFile);
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.nlink !== 1 && metadata.nlink !== 2)
    || metadata.uid !== expectedUid || (metadata.mode & 0o077) !== 0) {
    throw new ReleaseError("RELEASE_LOCK_UNSAFE", "Existing release lock is not a private owner-controlled file.");
  }
  const value = parseJson(readFileSync(lockFile, "utf8"), "RELEASE_LOCK_INVALID", "Release lock");
  if (!hasExactKeys(value, ["schemaVersion", "installationId", "stateFileHash", "pid", "processStartId", "nonce", "createdAt"])
    || value.schemaVersion !== LOCK_SCHEMA_VERSION
    || value.installationId !== options.installationId
    || value.stateFileHash !== sha256(options.stateFile)
    || !Number.isSafeInteger(value.pid) || value.pid < 1
    || typeof value.processStartId !== "string" || !/^[0-9a-f]{64}$/u.test(value.processStartId)
    || typeof value.nonce !== "string" || !/^[0-9a-f-]{36}$/u.test(value.nonce)
    || !isIsoDate(value.createdAt) || Date.parse(value.createdAt) > Date.now() + 60_000) {
    throw new ReleaseError("RELEASE_LOCK_INVALID", "Existing release lock failed identity validation.");
  }
  if (processIsAlive(value.pid)) {
    const actualStartId = processStartIdentity(value.pid);
    if (actualStartId === null || actualStartId === value.processStartId) {
      throw new ReleaseError("RELEASE_LOCKED", "Another live release operation owns the lock.");
    }
  }
  if (metadata.nlink === 2) {
    const pending = `${lockFile}.pending-${value.pid}-${value.nonce}`;
    if (!existsSync(pending) || lockIdentity(lstatSync(pending)) !== lockIdentity(metadata)) {
      throw new ReleaseError("RELEASE_LOCK_UNSAFE", "Dead release lock has an unrecognized hard link.");
    }
    unlinkDurably(pending);
    metadata = lstatSync(lockFile);
  }
  const before = lockIdentity(metadata);
  const confirmed = lstatSync(lockFile);
  if (lockIdentity(confirmed) !== before) {
    throw new ReleaseError("RELEASE_LOCK_CHANGED", "Release lock changed while checking its owner.");
  }
  const orphan = `${lockFile}.orphaned-${value.pid}-${randomUUID()}`;
  renameSync(lockFile, orphan);
  fsyncDirectory(path.dirname(lockFile));
  if (!sameFileObject(lstatSync(orphan), metadata)) {
    throw new ReleaseError("RELEASE_LOCK_CHANGED", "Recovered release lock identity is inconsistent.");
  }
  unlinkDurably(orphan);
}

function acquireReleaseLock(options) {
  const lockFile = `${options.stateFile}.lock`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    const nonce = randomUUID();
    const pending = `${lockFile}.pending-${process.pid}-${nonce}`;
    try {
      descriptor = openSync(pending, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      const value = {
        schemaVersion: LOCK_SCHEMA_VERSION,
        installationId: options.installationId,
        stateFileHash: sha256(options.stateFile),
        pid: process.pid,
        processStartId: processStartIdentity(process.pid),
        nonce,
        createdAt: new Date().toISOString(),
      };
      if (value.processStartId === null) {
        throw new ReleaseError("RELEASE_LOCK_FAILED", "Current process start identity is unavailable.");
      }
      writeFileSync(descriptor, `${JSON.stringify(value)}\n`);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      linkSync(pending, lockFile);
      fsyncDirectory(path.dirname(lockFile));
      unlinkDurably(pending);
      return { lockFile, identity: lockIdentity(lstatSync(lockFile)) };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(pending)) unlinkDurably(pending);
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        recoverOrRejectLock(options, lockFile);
        continue;
      }
      if (error instanceof ReleaseError) throw error;
      throw new ReleaseError("RELEASE_LOCK_FAILED", "Release lock could not be created.", { cause: error });
    }
  }
  throw new ReleaseError("RELEASE_LOCK_FAILED", "Release lock could not be acquired after orphan recovery.");
}

function withReleaseLock(options, operation) {
  const owned = acquireReleaseLock(options);
  let result;
  let operationError;
  try {
    result = operation();
  } catch (error) {
    operationError = error;
  }
  try {
    const current = lstatSync(owned.lockFile);
    if (lockIdentity(current) !== owned.identity) {
      throw new ReleaseError("RELEASE_LOCK_LOST", "Release lock identity changed before cleanup.");
    }
    unlinkDurably(owned.lockFile);
  } catch (cleanupError) {
    if (operationError !== undefined) throw operationError;
    throw new ReleaseError(
      "RELEASE_COMMITTED_LOCK_CLEANUP_FAILED",
      "Release operation committed, but its lock could not be cleaned; durable state remains authoritative.",
      { cause: cleanupError },
    );
  }
  if (operationError !== undefined) throw operationError;
  return result;
}

function executeUnlocked(options) {
  const initialEnvContents = readFileSync(options.envFile, "utf8");
  const initialEnv = parseEnv(initialEnvContents);
  if (initialEnv.get("AIBRAIN_INSTALLATION_ID") !== options.installationId) {
    throw new ReleaseError("RELEASE_INSTALLATION_MISMATCH", "Compose env belongs to another installation.");
  }
  const composeProject = initialEnv.get("AIBRAIN_COMPOSE_PROJECT_NAME");
  if (composeProject !== `aibrain-${options.installationId}`) {
    throw new ReleaseError("RELEASE_PROJECT_MISMATCH", "Compose project must exactly identify the installation.");
  }
  recoverPendingTransaction(options, initialEnvContents, composeProject);

  const envContents = readFileSync(options.envFile, "utf8");
  const env = parseEnv(envContents);
  if (env.get("AIBRAIN_INSTALLATION_ID") !== options.installationId
    || env.get("AIBRAIN_COMPOSE_PROJECT_NAME") !== composeProject) {
    throw new ReleaseError("RELEASE_ENV_DRIFT", "Compose identity changed during release recovery.");
  }
  const currentImage = env.get("AIBRAIN_IMAGE");
  const currentEgressImage = env.get("AIBRAIN_EGRESS_IMAGE");
  if (!currentImage || !IMAGE.test(currentImage) || !currentEgressImage || !IMAGE.test(currentEgressImage)) {
    throw new ReleaseError("RELEASE_IMAGE_MUTABLE", "Current Compose app and egress images must already use immutable digests.");
  }
  const stateSnapshot = readStateSnapshot(options);
  const state = stateSnapshot.value;
  if (state && (state.composeProject !== composeProject
      || state.current.image !== currentImage || state.current.egressImage !== currentEgressImage)) {
    throw new ReleaseError(
      "RELEASE_STATE_DRIFT",
      "Compose image does not match the current durable release state.",
    );
  }
  const operationDeadline = performance.now() + options.healthTimeoutMs;
  const currentRevision = inspectImage(options, currentImage, null, operationDeadline);
  inspectImage(options, currentEgressImage, currentRevision, operationDeadline);
  if (state && state.current.revision !== currentRevision) {
    throw new ReleaseError("RELEASE_STATE_DRIFT", "Current image revision does not match durable release state.");
  }
  const current = state?.current ?? releaseRecord(currentImage, currentEgressImage, currentRevision);
  verifyCurrentDeployment(options, current, operationDeadline);
  const target = options.command === "promote"
    ? releaseRecord(
      options.image,
      options.egressImage,
      (() => {
        const revision = inspectImage(options, options.image, options.revision, operationDeadline);
        inspectImage(options, options.egressImage, options.revision, operationDeadline);
        return revision;
      })(),
    )
    : state?.previous;
  if (!target) throw new ReleaseError("RELEASE_ROLLBACK_UNAVAILABLE", "No previous release is recorded.");
  if (options.command === "rollback") {
    inspectImage(options, target.image, target.revision, operationDeadline);
    inspectImage(options, target.egressImage, target.revision, operationDeadline);
  }
  if (releaseIdentityMatches(target, current)) {
    throw new ReleaseError("RELEASE_NO_CHANGE", "Target release is already current.");
  }

  const targetEnvContents = replaceImages(envContents, target);
  const nextState = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    installationId: options.installationId,
    composeProject,
    updatedAt: new Date().toISOString(),
    current: target,
    previous: current,
  };
  const createdAt = new Date().toISOString();
  const recoveryState = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    installationId: options.installationId,
    composeProject,
    updatedAt: createdAt,
    current,
    previous: target,
  };
  let transaction = writeTransaction(options, {
    schemaVersion: TRANSACTION_SCHEMA_VERSION,
    installationId: options.installationId,
    composeProject,
    operation: options.command,
    phase: "prepared",
    environmentBeforeHash: sha256(envContents),
    environmentTargetHash: sha256(targetEnvContents),
    stateBeforeHash: stateSnapshot.hash,
    current,
    target,
    nextState,
    recoveryState,
    createdAt,
    updatedAt: createdAt,
  }, "prepared");
  writeAtomic(options.envFile, targetEnvContents);
  transaction = writeTransaction(options, transaction, "environment-updated");
  try {
    deploy(options, target, operationDeadline);
  } catch (error) {
    const failedEnvironment = readFileSync(options.envFile, "utf8");
    if (sha256(failedEnvironment) !== transaction.environmentTargetHash) {
      throw new ReleaseError(
        "RELEASE_ENV_DRIFT_DURING_RECOVERY",
        "Compose environment changed during the failed release; automatic recovery will not overwrite it.",
        { cause: error },
      );
    }
    transaction = writeTransaction(options, transaction, "recovering-previous");
    writeAtomic(options.envFile, envContents);
    try {
      deploy(options, current);
    } catch (rollbackError) {
      throw new ReleaseError(
        "RELEASE_AND_RECOVERY_FAILED",
        "Release failed and the previous image could not be recovered automatically.",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    clearTransaction(options);
    throw new ReleaseError("RELEASE_RECOVERED", "Release failed; the previous image was restored and is healthy.", { cause: error });
  }
  transaction = writeTransaction(options, transaction, "target-healthy");
  writeAtomic(options.stateFile, `${JSON.stringify(nextState, null, 2)}\n`);
  transaction = writeTransaction(options, transaction, "state-committed");
  clearTransaction(options);
  return nextState;
}

function execute(options) {
  return withReleaseLock(options, () => executeUnlocked(options));
}

function advisoryLockInvocation(options, argv) {
  const script = realpathSync(new URL(import.meta.url).pathname);
  const lockFile = `${options.stateFile}.advisory`;
  if (existsSync(lockFile)) {
    const metadata = lstatSync(lockFile);
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== expectedUid) {
      throw new ReleaseError("RELEASE_LOCK_UNSAFE", "OS advisory lock path is not an owner-controlled regular file.");
    }
  }
  if (process.platform === "darwin") {
    return {
      executable: "/usr/bin/lockf",
      args: ["-t", "0", lockFile, process.execPath, script, ...argv],
      conflictStatus: 75,
    };
  }
  if (process.platform === "linux") {
    return {
      executable: "/usr/bin/flock",
      args: ["--exclusive", "--nonblock", "--conflict-exit-code", "73", lockFile, process.execPath, script, ...argv],
      conflictStatus: 73,
    };
  }
  throw new ReleaseError("RELEASE_LOCK_PLATFORM_UNSUPPORTED", "An OS advisory lock helper is required on this host.");
}

function runCli(argv) {
  const options = parseArguments(argv);
  const advisoryIdentity = sha256(options.stateFile);
  if (process.env.AIBRAIN_RELEASE_ADVISORY_LOCK !== advisoryIdentity) {
    const invocation = advisoryLockInvocation(options, argv);
    try {
      execFileSync(invocation.executable, invocation.args, {
        stdio: "inherit",
        env: { ...process.env, AIBRAIN_RELEASE_ADVISORY_LOCK: advisoryIdentity },
        timeout: Math.min(1_800_000, options.healthTimeoutMs * 2 + options.dockerCommandTimeoutMs * 8),
        killSignal: "SIGKILL",
      });
      return;
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === invocation.conflictStatus) {
        throw new ReleaseError("RELEASE_LOCKED", "Another live release operation owns the OS advisory lock.");
      }
      if (error && typeof error === "object" && "status" in error && Number.isInteger(error.status)) {
        process.exitCode = error.status;
        return;
      }
      throw new ReleaseError("RELEASE_LOCK_HELPER_FAILED", "OS advisory lock helper failed.", { cause: error });
    }
  }
  const result = execute(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export { ReleaseError, execute, parseArguments, runCli };

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const code = error instanceof ReleaseError ? error.code : "RELEASE_FAILED";
    const message = error instanceof Error ? error.message : "Release failed.";
    process.stderr.write(`${code}: ${message}\n`);
    process.exitCode = 1;
  }
}
