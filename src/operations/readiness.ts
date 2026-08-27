import { constants } from "node:fs";
import { access, lstat, statfs } from "node:fs/promises";
import type { InstallationConfig } from "@/config/installation-schema";

export type ReadinessCheckName =
  | "data-root"
  | "backups-root"
  | "company-context"
  | "users-root"
  | "source-read"
  | "publish-write"
  | "disk-capacity"
  | "docker-socket";

export type ReadinessCheck = Readonly<{
  name: ReadinessCheckName;
  status: "pass" | "fail";
  code: string;
}>;

export type ReadinessReport = Readonly<{
  schemaVersion: 1;
  status: "ready" | "degraded";
  checkedAt: string;
  disk: Readonly<{ freeBytes: number; totalBytes: number; freeRatio: number }> | null;
  checks: readonly ReadinessCheck[];
}>;

export type ReadinessOptions = {
  now?: () => number;
  minimumFreeBytes?: number;
  minimumFreeRatio?: number;
  dockerSocketPath?: string;
};

function validNonNegativeInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer.`);
  return value;
}

function validRatio(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("minimumFreeRatio must be between 0 and 1.");
  }
  return value;
}

async function directoryCheck(
  name: ReadinessCheckName,
  directory: string,
  mode: number,
  code: string,
) {
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("unsafe directory");
    await access(directory, mode);
    return { name, status: "pass", code: "OK" } as const;
  } catch {
    return { name, status: "fail", code } as const;
  }
}

async function readOnlyDirectoryCheck(name: ReadinessCheckName, directory: string) {
  const readable = await directoryCheck(
    name,
    directory,
    constants.R_OK | constants.X_OK,
    "SOURCE_READ_UNAVAILABLE",
  );
  if (readable.status === "fail") return readable;
  try {
    await access(directory, constants.W_OK);
    return { name, status: "fail", code: "SOURCE_READ_WRITABLE" } as const;
  } catch {
    return readable;
  }
}

async function dockerSocketCheck(socketPath: string) {
  try {
    await lstat(socketPath);
    return { name: "docker-socket", status: "fail", code: "DOCKER_SOCKET_PRESENT" } as const;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { name: "docker-socket", status: "pass", code: "OK" } as const;
    }
    return { name: "docker-socket", status: "fail", code: "DOCKER_SOCKET_CHECK_FAILED" } as const;
  }
}

function safeFilesystemNumber(value: bigint) {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > maximum ? maximum : value);
}

export async function checkInstallationReadiness(
  config: Readonly<InstallationConfig>,
  options: ReadinessOptions = {},
): Promise<ReadinessReport> {
  const now = options.now ?? Date.now;
  const minimumFreeBytes = validNonNegativeInteger(
    "minimumFreeBytes",
    options.minimumFreeBytes ?? 1024 * 1024 * 1024,
  );
  const minimumFreeRatio = validRatio(options.minimumFreeRatio ?? 0.05);
  const checks: ReadinessCheck[] = await Promise.all([
    directoryCheck("data-root", config.paths.dataRoot, constants.R_OK | constants.W_OK | constants.X_OK, "DATA_ROOT_UNAVAILABLE"),
    directoryCheck("backups-root", config.paths.backupsRoot, constants.R_OK | constants.W_OK | constants.X_OK, "BACKUPS_ROOT_UNAVAILABLE"),
    directoryCheck("company-context", config.paths.companyContextRoot, constants.R_OK | constants.X_OK, "COMPANY_CONTEXT_UNAVAILABLE"),
    directoryCheck("users-root", config.paths.usersRoot, constants.R_OK | constants.W_OK | constants.X_OK, "USERS_ROOT_UNAVAILABLE"),
    readOnlyDirectoryCheck("source-read", config.paths.sourceReadRoot),
    directoryCheck("publish-write", config.paths.publishWriteRoot, constants.R_OK | constants.W_OK | constants.X_OK, "PUBLISH_WRITE_UNAVAILABLE"),
    dockerSocketCheck(options.dockerSocketPath ?? "/var/run/docker.sock"),
  ]);

  let disk: ReadinessReport["disk"] = null;
  try {
    const filesystem = await statfs(config.paths.dataRoot, { bigint: true });
    const freeBytes = safeFilesystemNumber(filesystem.bavail * filesystem.bsize);
    const totalBytes = safeFilesystemNumber(filesystem.blocks * filesystem.bsize);
    const freeRatio = totalBytes === 0 ? 0 : freeBytes / totalBytes;
    disk = Object.freeze({ freeBytes, totalBytes, freeRatio });
    checks.push({
      name: "disk-capacity",
      status: freeBytes >= minimumFreeBytes && freeRatio >= minimumFreeRatio ? "pass" : "fail",
      code: freeBytes >= minimumFreeBytes && freeRatio >= minimumFreeRatio ? "OK" : "DISK_CAPACITY_LOW",
    });
  } catch {
    checks.push({ name: "disk-capacity", status: "fail", code: "DISK_CAPACITY_UNAVAILABLE" });
  }

  return Object.freeze({
    schemaVersion: 1,
    status: checks.some((check) => check.status === "fail") ? "degraded" : "ready",
    checkedAt: new Date(now()).toISOString(),
    disk,
    checks: Object.freeze(checks),
  });
}
