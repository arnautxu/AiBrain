import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
} from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  defineVersionedSchema,
  expectArray,
  expectInteger,
  expectIsoDate,
  expectStrictRecord,
  expectString,
  fsyncDirectory,
  parseJson,
  ResourceLockManager,
  type ValidationContext,
} from "@/storage";
import { readRegularFileWithin } from "@/security/safe-file";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const INSTALLATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const BACKUP_ID_PATTERN = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f-]{36}$/;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const SENSITIVE_ROOT_DIRECTORIES = new Set(["auth-challenges", "secrets", "sessions"]);

export class BackupError extends Error {
  constructor(readonly code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "BackupError";
  }
}

export type BackupManifestEntry = {
  path: string;
  size: number;
  sha256: string;
  mode: number;
};

export type BackupManifest = {
  schemaVersion: 1;
  backupId: string;
  installationId: string;
  createdAt: string;
  sourceFingerprint: string;
  files: BackupManifestEntry[];
};

function parseEntry(value: unknown, context: ValidationContext): BackupManifestEntry {
  const record = expectStrictRecord(value, ["path", "size", "sha256", "mode"], context);
  const relativePath = expectString(record.path, context.at("path"), {
    minLength: 1,
    maxLength: 4_096,
  });
  if (!safeRelativePath(relativePath)) context.at("path").fail("expected a safe POSIX relative path");
  return {
    path: relativePath,
    size: expectInteger(record.size, context.at("size"), { minimum: 0 }),
    sha256: expectString(record.sha256, context.at("sha256"), {
      minLength: 64,
      maxLength: 64,
      pattern: HASH_PATTERN,
    }),
    mode: expectInteger(record.mode, context.at("mode"), { minimum: 0, maximum: 0o700 }),
  };
}

export const backupManifestSchema = defineVersionedSchema<BackupManifest>({
  name: "BackupManifest",
  schemaVersion: 1,
  keys: ["backupId", "installationId", "createdAt", "sourceFingerprint", "files"],
  parse(record, context) {
    const files = expectArray(record.files, context.at("files"), parseEntry, { maxLength: 1_000_000 });
    const paths = files.map((entry) => entry.path);
    if (new Set(paths).size !== paths.length) context.at("files").fail("contains duplicate paths");
    if (paths.some((entry, index) => index > 0 && paths[index - 1].localeCompare(entry) >= 0)) {
      context.at("files").fail("must be sorted by path");
    }
    return {
      schemaVersion: 1,
      backupId: expectString(record.backupId, context.at("backupId"), {
        minLength: 53,
        maxLength: 53,
        pattern: BACKUP_ID_PATTERN,
      }),
      installationId: expectString(record.installationId, context.at("installationId"), {
        minLength: 2,
        maxLength: 63,
        pattern: INSTALLATION_ID_PATTERN,
      }),
      createdAt: expectIsoDate(record.createdAt, context.at("createdAt")),
      sourceFingerprint: expectString(record.sourceFingerprint, context.at("sourceFingerprint"), {
        minLength: 64,
        maxLength: 64,
        pattern: HASH_PATTERN,
      }),
      files,
    };
  },
});

function safeRelativePath(value: string) {
  return !path.posix.isAbsolute(value)
    && !value.includes("\\")
    && !value.includes("\0")
    && path.posix.normalize(value) === value
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * Credentials and browser identity must never enter a product-state snapshot.
 * The policy is based on canonical paths relative to dataRoot, never on file
 * contents, so a backup cannot leak a secret while trying to classify it.
 */
export function excludedBackupPath(relativePath: string) {
  if (!safeRelativePath(relativePath)) return false;
  const segments = relativePath.split("/");
  const basename = segments.at(-1) as string;
  if (SENSITIVE_ROOT_DIRECTORIES.has(segments[0])) return true;
  if (basename === "auth.json" || basename === ".env" || basename.startsWith(".env.")) {
    return true;
  }
  return segments.length >= 4 && segments[0] === "users" &&
    segments[2] === "browser" && segments[3] === "profile";
}

function backupId(now: number) {
  return `${new Date(now).toISOString().replace(/[-:]/g, "").replace(".000", "")}-${randomUUID()}`;
}

function sourceFingerprint(files: readonly BackupManifestEntry[]) {
  const hash = createHash("sha256");
  for (const entry of files) {
    hash.update(entry.path).update("\0");
    hash.update(String(entry.size)).update("\0");
    hash.update(entry.sha256).update("\0");
    hash.update(String(entry.mode)).update("\n");
  }
  return hash.digest("hex");
}

async function assertRealDirectory(directory: string) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new BackupError("BACKUP_PATH_UNSAFE", "Backup boundary must be a real directory.");
  }
}

async function listSourceFiles(
  dataRoot: string,
  backupsRoot: string,
  current = dataRoot,
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    if (inside(backupsRoot, absolute) || inside(absolute, backupsRoot)) continue;
    const relative = path.relative(dataRoot, absolute).split(path.sep).join("/");
    if (relative.split("/").includes("locks")) continue;
    if (excludedBackupPath(relative)) continue;
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) {
      throw new BackupError("BACKUP_SYMLINK_REJECTED", `Refusing symbolic link ${relative}.`);
    }
    if (metadata.isDirectory()) {
      results.push(...await listSourceFiles(dataRoot, backupsRoot, absolute));
      continue;
    }
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new BackupError("BACKUP_FILE_UNSAFE", `Refusing non-regular or hard-linked file ${relative}.`);
    }
    if (!safeRelativePath(relative)) {
      throw new BackupError("BACKUP_PATH_UNSAFE", "Source contains an unsafe relative path.");
    }
    results.push(relative);
  }
  return results.sort((left, right) => left.localeCompare(right));
}

async function copyAndHash(
  source: string,
  destination: string,
  expected?: Pick<BackupManifestEntry, "size" | "sha256">,
) {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const sourceHandle = await open(source, constants.O_RDONLY | noFollow);
  const destinationHandle = await open(destination, "wx", 0o600);
  try {
    const before = await sourceHandle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw new BackupError("BACKUP_FILE_UNSAFE", "Backup source is not an exclusive regular file.");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      await destinationHandle.write(chunk);
      position += bytesRead;
    }
    await destinationHandle.sync();
    const after = await sourceHandle.stat({ bigint: true });
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || BigInt(position) !== after.size
    ) {
      throw new BackupError("BACKUP_SOURCE_CHANGED", "Source changed while the snapshot was being copied.");
    }
    const sha256 = hash.digest("hex");
    if (expected && (expected.size !== position || expected.sha256 !== sha256)) {
      throw new BackupError("BACKUP_INTEGRITY_FAILED", "Backup content does not match its manifest.");
    }
    return { size: position, sha256, mode: Number(before.mode & 0o700n) };
  } finally {
    await Promise.allSettled([sourceHandle.close(), destinationHandle.close()]);
  }
}

async function freezeTree(root: string, freezeRoot = true) {
  const directories: string[] = [];
  async function walk(directory: string) {
    directories.push(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else await chmod(target, 0o400);
    }
  }
  await walk(root);
  for (const directory of directories.reverse()) {
    if (directory !== root || freezeRoot) await chmod(directory, 0o500);
  }
}

export class FileBackupService {
  private readonly lockManager: ResourceLockManager;

  constructor(
    readonly dataRoot: string,
    readonly backupsRoot: string,
    readonly installationId: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!path.isAbsolute(dataRoot) || !path.isAbsolute(backupsRoot)) {
      throw new BackupError("BACKUP_PATH_INVALID", "Backup roots must be absolute.");
    }
    if (!INSTALLATION_ID_PATTERN.test(installationId)) {
      throw new BackupError("BACKUP_INSTALLATION_INVALID", "Installation id is invalid.");
    }
    this.dataRoot = path.resolve(dataRoot);
    this.backupsRoot = path.resolve(backupsRoot);
    if (!inside(this.dataRoot, this.backupsRoot) || this.dataRoot === this.backupsRoot) {
      throw new BackupError("BACKUP_PATH_INVALID", "backupsRoot must be below dataRoot.");
    }
    this.lockManager = new ResourceLockManager({
      rootDirectory: path.join(this.backupsRoot, "locks"),
    });
  }

  async create() {
    return this.lockManager.withLock(`backup:${this.installationId}`, async () => {
      await assertRealDirectory(this.dataRoot);
      await mkdir(path.join(this.backupsRoot, "snapshots"), { recursive: true, mode: 0o700 });
      const id = backupId(this.now());
      const pendingRoot = path.join(this.backupsRoot, "snapshots", `.${id}.pending`);
      const finalRoot = path.join(this.backupsRoot, "snapshots", id);
      await mkdir(path.join(pendingRoot, "data"), { recursive: true, mode: 0o700 });
      const files: BackupManifestEntry[] = [];
      for (const relativePath of await listSourceFiles(this.dataRoot, this.backupsRoot)) {
        const source = path.join(this.dataRoot, ...relativePath.split("/"));
        const destination = path.join(pendingRoot, "data", ...relativePath.split("/"));
        const copied = await copyAndHash(source, destination);
        files.push({ path: relativePath, ...copied });
      }
      const manifest = backupManifestSchema.parse({
        schemaVersion: 1,
        backupId: id,
        installationId: this.installationId,
        createdAt: new Date(this.now()).toISOString(),
        sourceFingerprint: sourceFingerprint(files),
        files,
      });
      await atomicWriteJson(path.join(pendingRoot, "manifest.json"), manifest, backupManifestSchema, {
        mode: 0o400,
      });
      await freezeTree(pendingRoot, false);
      await rename(pendingRoot, finalRoot);
      await chmod(finalRoot, 0o500);
      await fsyncDirectory(path.dirname(finalRoot));
      return { manifest, snapshotRoot: finalRoot };
    });
  }

  async verify(snapshotRoot: string) {
    const root = path.resolve(snapshotRoot);
    const canonicalSnapshots = await realpath(path.join(this.backupsRoot, "snapshots"));
    const canonicalRoot = await realpath(root);
    if (!inside(canonicalSnapshots, canonicalRoot) || canonicalRoot === canonicalSnapshots) {
      throw new BackupError("BACKUP_PATH_UNSAFE", "Snapshot is outside backupsRoot.");
    }
    const manifestContents = await readRegularFileWithin(root, "manifest.json", MAX_MANIFEST_BYTES);
    const manifest = parseJson(backupManifestSchema, manifestContents.toString("utf8"), "manifest.json");
    if (manifest.installationId !== this.installationId || path.basename(root) !== manifest.backupId) {
      throw new BackupError("BACKUP_MANIFEST_MISMATCH", "Snapshot does not belong to this installation.");
    }
    const actual = await listSourceFiles(path.join(root, "data"), path.join(root, "excluded-backups"));
    if (actual.length !== manifest.files.length
      || actual.some((entry, index) => entry !== manifest.files[index]?.path)) {
      throw new BackupError("BACKUP_INTEGRITY_FAILED", "Snapshot files do not match the manifest.");
    }
    for (const entry of manifest.files) {
      const source = path.join(root, "data", ...entry.path.split("/"));
      const handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const hash = createHash("sha256");
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (!bytesRead) break;
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
        if (position !== entry.size || hash.digest("hex") !== entry.sha256) {
          throw new BackupError("BACKUP_INTEGRITY_FAILED", `Snapshot file failed verification: ${entry.path}.`);
        }
      } finally {
        await handle.close();
      }
    }
    if (sourceFingerprint(manifest.files) !== manifest.sourceFingerprint) {
      throw new BackupError("BACKUP_INTEGRITY_FAILED", "Snapshot manifest fingerprint is invalid.");
    }
    return manifest;
  }

  async restore(snapshotRoot: string, destinationRoot: string) {
    if (!path.isAbsolute(destinationRoot)) {
      throw new BackupError("RESTORE_PATH_INVALID", "Restore destination must be absolute.");
    }
    const destination = path.resolve(destinationRoot);
    if (inside(this.dataRoot, destination) || inside(destination, this.dataRoot)) {
      throw new BackupError("RESTORE_PATH_INVALID", "Restore destination must be separate from live dataRoot.");
    }
    try {
      await lstat(destination);
      throw new BackupError("RESTORE_DESTINATION_EXISTS", "Restore destination must not exist.");
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    const manifest = await this.verify(snapshotRoot);
    await mkdir(destination, { mode: 0o700 });
    try {
      for (const entry of manifest.files) {
        const source = path.join(snapshotRoot, "data", ...entry.path.split("/"));
        const target = path.join(destination, ...entry.path.split("/"));
        await copyAndHash(source, target, entry);
        await chmod(target, entry.mode & 0o600);
      }
      await atomicWriteJson(
        path.join(destination, ".aibrain-restore.json"),
        manifest,
        backupManifestSchema,
        { mode: 0o400 },
      );
      return { manifest, destinationRoot: destination };
    } catch (error) {
      const failed = `${destination}.failed.${randomUUID()}`;
      await rename(destination, failed).catch(() => undefined);
      throw new BackupError("RESTORE_FAILED", `Restore failed; partial data was preserved at ${failed}.`, {
        cause: error,
      });
    }
  }
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(
    error && typeof error === "object" && "code" in error
    && (code === undefined || (error as NodeJS.ErrnoException).code === code),
  );
}
