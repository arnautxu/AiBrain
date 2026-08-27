import { lstat, chmod, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import {
  atomicWriteJson,
  readValidatedJson,
  ResourceLockManager,
  defineVersionedSchema,
  expectIsoDate,
  expectString,
  type StorageSchema,
  type ValidationContext,
} from "@/storage";
import {
  WORKER_PROVISIONING_SCHEMA_VERSION,
  type WorkerEnvironment,
  type WorkerLaunchContext,
  type WorkerProvisioningManifest,
  type WorkerRoots,
} from "@/runtime/workers/types";

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTALLATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ROOT_KEYS = [
  "userRoot",
  "runtimeRoot",
  "codexHome",
  "home",
  "xdgRoot",
  "xdgCache",
  "xdgConfig",
  "xdgData",
  "xdgState",
  "workspace",
  "staging",
  "stagingTemp",
  "artifacts",
  "browserRoot",
  "browserProfile",
  "browserDownloads",
  "auditRoot",
  "transportAudit",
  "manifest",
] as const satisfies readonly (keyof WorkerRoots)[];

export class WorkerProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "WorkerProvisioningError";
  }
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && (code === undefined || (error as NodeJS.ErrnoException).code === code),
  );
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function overlaps(left: string, right: string) {
  return inside(left, right) || inside(right, left);
}

export function validateWorkerUserId(userId: string) {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new WorkerProvisioningError(
      "WORKER_USER_ID_INVALID",
      "Worker userId must be a canonical lowercase UUID.",
    );
  }
  return userId;
}

function workerIdFor(userId: string) {
  return `worker-${userId}`;
}

export function deriveWorkerRoots(config: Readonly<InstallationConfig>, userId: string): WorkerRoots {
  validateWorkerUserId(userId);
  const usersRoot = path.resolve(config.paths.usersRoot);
  const userRoot = path.resolve(usersRoot, userId);
  if (!inside(usersRoot, userRoot) || userRoot === usersRoot) {
    throw new WorkerProvisioningError("WORKER_PATH_ESCAPE", "Worker root escapes usersRoot.");
  }
  const runtimeRoot = path.join(userRoot, "runtime");
  const xdgRoot = path.join(runtimeRoot, "xdg");
  const staging = path.join(userRoot, "staging");
  const browserRoot = path.join(userRoot, "browser");
  const auditRoot = path.join(userRoot, "audit");
  const roots: WorkerRoots = {
    userRoot,
    runtimeRoot,
    codexHome: path.join(runtimeRoot, "codex-home"),
    home: path.join(runtimeRoot, "home"),
    xdgRoot,
    xdgCache: path.join(xdgRoot, "cache"),
    xdgConfig: path.join(xdgRoot, "config"),
    xdgData: path.join(xdgRoot, "data"),
    xdgState: path.join(xdgRoot, "state"),
    workspace: path.join(userRoot, "workspace"),
    staging,
    stagingTemp: path.join(staging, "tmp"),
    artifacts: path.join(userRoot, "artifacts"),
    browserRoot,
    browserProfile: path.join(browserRoot, "profile"),
    browserDownloads: path.join(browserRoot, "downloads"),
    auditRoot,
    transportAudit: path.join(auditRoot, "transport"),
    manifest: path.join(userRoot, "worker.json"),
  };
  const publishWriteRoot = path.resolve(config.paths.publishWriteRoot);
  if (ROOT_KEYS.some((key) => overlaps(path.resolve(roots[key]), publishWriteRoot))) {
    throw new WorkerProvisioningError(
      "WORKER_PUBLISH_PATH_OVERLAP",
      "Worker-owned roots must not overlap publishWriteRoot.",
    );
  }
  return roots;
}

function parseRoots(value: unknown, context: ValidationContext): WorkerRoots {
  if (!value || typeof value !== "object" || Array.isArray(value)) context.fail("expected an object");
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...ROOT_KEYS].sort();
  if (actualKeys.join("\0") !== expectedKeys.join("\0")) {
    context.fail("root keys do not match the worker provisioning contract");
  }
  return Object.fromEntries(ROOT_KEYS.map((key) => [
    key,
    expectString(record[key], context.at(key), { minLength: 2, maxLength: 1_024 }),
  ])) as WorkerRoots;
}

const workerManifestSchema: StorageSchema<WorkerProvisioningManifest> = defineVersionedSchema({
  name: "WorkerProvisioningManifest",
  schemaVersion: WORKER_PROVISIONING_SCHEMA_VERSION,
  keys: ["installationId", "userId", "workerId", "provisionedAt", "roots"],
  parse(record, context) {
    return {
      schemaVersion: WORKER_PROVISIONING_SCHEMA_VERSION,
      installationId: expectString(record.installationId, context.at("installationId"), {
        minLength: 2,
        maxLength: 63,
        pattern: INSTALLATION_ID_PATTERN,
      }),
      userId: expectString(record.userId, context.at("userId"), {
        minLength: 36,
        maxLength: 36,
        pattern: USER_ID_PATTERN,
      }),
      workerId: expectString(record.workerId, context.at("workerId"), {
        minLength: 43,
        maxLength: 43,
        pattern: /^worker-[0-9a-f-]{36}$/,
      }),
      provisionedAt: expectIsoDate(record.provisionedAt, context.at("provisionedAt")),
      roots: parseRoots(record.roots, context.at("roots")),
    };
  },
});

async function assertDirectory(directory: string) {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new WorkerProvisioningError(
      "WORKER_SYMLINK_REJECTED",
      `Worker path must be a real directory: ${directory}`,
    );
  }
  await chmod(directory, 0o700);
}

async function ensureDirectory(directory: string) {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  await assertDirectory(directory);
}

async function ensureDescendantTree(root: string, target: string) {
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new WorkerProvisioningError("WORKER_PATH_ESCAPE", "Worker directory escapes its secure root.");
  }
  const canonicalRoot = await realpath(root);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    await ensureDirectory(current);
    const canonicalCurrent = await realpath(current);
    if (!inside(canonicalRoot, canonicalCurrent)) {
      throw new WorkerProvisioningError("WORKER_PATH_ESCAPE", "Worker directory resolves outside its secure root.");
    }
  }
}

async function assertManifestIsRegular(manifestPath: string) {
  try {
    const metadata = await lstat(manifestPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new WorkerProvisioningError(
        "WORKER_SYMLINK_REJECTED",
        "Worker provisioning manifest must be a regular file.",
      );
    }
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function manifestsMatch(
  existing: WorkerProvisioningManifest,
  expected: Omit<WorkerProvisioningManifest, "provisionedAt">,
) {
  return existing.schemaVersion === expected.schemaVersion
    && existing.installationId === expected.installationId
    && existing.userId === expected.userId
    && existing.workerId === expected.workerId
    && ROOT_KEYS.every((key) => existing.roots[key] === expected.roots[key]);
}

export type WorkerProvisionerOptions = {
  config: Readonly<InstallationConfig>;
  lockManager?: ResourceLockManager;
  now?: () => number;
};

export class WorkerProvisioner {
  readonly config: Readonly<InstallationConfig>;
  readonly lockManager: ResourceLockManager;
  private readonly now: () => number;
  private readonly lockRoot: string;

  constructor(options: WorkerProvisionerOptions) {
    this.config = options.config;
    this.lockRoot = path.join(this.config.paths.dataRoot, "locks", "worker-provisioning");
    this.lockManager = options.lockManager ?? new ResourceLockManager({
      rootDirectory: this.lockRoot,
    });
    this.now = options.now ?? Date.now;
  }

  async provision(userId: string): Promise<WorkerProvisioningManifest> {
    const roots = deriveWorkerRoots(this.config, userId);
    await mkdir(this.config.paths.dataRoot, { recursive: true, mode: 0o700 });
    await assertDirectory(this.config.paths.dataRoot);
    await ensureDescendantTree(this.config.paths.dataRoot, this.config.paths.usersRoot);
    await ensureDescendantTree(this.config.paths.dataRoot, this.lockRoot);

    return this.lockManager.withLock(
      `worker-provision:${this.config.installationId}:${userId}`,
      async () => {
        await ensureDescendantTree(this.config.paths.usersRoot, roots.userRoot);
        const directories = ROOT_KEYS
          .filter((key) => key !== "userRoot" && key !== "manifest")
          .map((key) => roots[key])
          .sort((left, right) => left.split(path.sep).length - right.split(path.sep).length);
        for (const directory of directories) {
          await ensureDescendantTree(roots.userRoot, directory);
        }

        const expected = {
          schemaVersion: WORKER_PROVISIONING_SCHEMA_VERSION,
          installationId: this.config.installationId,
          userId,
          workerId: workerIdFor(userId),
          roots,
        } as const;
        if (await assertManifestIsRegular(roots.manifest)) {
          const existing = await readValidatedJson(roots.manifest, workerManifestSchema);
          if (!manifestsMatch(existing, expected)) {
            throw new WorkerProvisioningError(
              "WORKER_MANIFEST_MISMATCH",
              "Existing worker provisioning does not match this installation or user.",
            );
          }
          await chmod(roots.manifest, 0o600);
          return existing;
        }

        const created = workerManifestSchema.parse({
          ...expected,
          provisionedAt: new Date(this.now()).toISOString(),
        }, roots.manifest);
        await atomicWriteJson(roots.manifest, created, workerManifestSchema, { mode: 0o600 });
        await chmod(roots.manifest, 0o600);
        return created;
      },
    );
  }
}

export function buildWorkerLaunchContext(
  config: Readonly<InstallationConfig>,
  manifest: WorkerProvisioningManifest,
): WorkerLaunchContext {
  const expectedRoots = deriveWorkerRoots(config, manifest.userId);
  if (
    manifest.installationId !== config.installationId
    || manifest.workerId !== workerIdFor(manifest.userId)
    || ROOT_KEYS.some((key) => manifest.roots[key] !== expectedRoots[key])
  ) {
    throw new WorkerProvisioningError(
      "WORKER_MANIFEST_MISMATCH",
      "Worker manifest does not belong to this installation.",
    );
  }
  const environment: WorkerEnvironment = Object.freeze({
    HOME: expectedRoots.home,
    CODEX_HOME: expectedRoots.codexHome,
    XDG_CACHE_HOME: expectedRoots.xdgCache,
    XDG_CONFIG_HOME: expectedRoots.xdgConfig,
    XDG_DATA_HOME: expectedRoots.xdgData,
    XDG_STATE_HOME: expectedRoots.xdgState,
    TMPDIR: expectedRoots.stagingTemp,
  });
  return Object.freeze({
    installationId: config.installationId,
    userId: manifest.userId,
    workerId: manifest.workerId,
    environment,
    mounts: Object.freeze({
      runtimeReadOnly: Object.freeze([
        config.paths.companyContextRoot,
        config.paths.sourceReadRoot,
      ]),
      runtimeReadWrite: Object.freeze([
        expectedRoots.codexHome,
        expectedRoots.home,
        expectedRoots.xdgRoot,
        expectedRoots.workspace,
        expectedRoots.stagingTemp,
        expectedRoots.artifacts,
        expectedRoots.transportAudit,
      ]),
      browserReadWrite: Object.freeze([
        expectedRoots.browserProfile,
        expectedRoots.browserDownloads,
      ]),
    }),
    workspace: expectedRoots.workspace,
    staging: expectedRoots.staging,
    artifacts: expectedRoots.artifacts,
    transportAudit: expectedRoots.transportAudit,
    browser: Object.freeze({
      profile: expectedRoots.browserProfile,
      downloads: expectedRoots.browserDownloads,
    }),
  });
}

export async function resolveWorkerOwnedPath(
  root: string,
  relativePath: string,
) {
  const segments = relativePath.split(/[\\/]/u);
  if (
    !path.isAbsolute(root)
    || path.isAbsolute(relativePath)
    || relativePath.length === 0
    || relativePath.includes("\\")
    || /\p{C}/u.test(relativePath)
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new WorkerProvisioningError("WORKER_PATH_INVALID", "Worker path boundary is invalid.");
  }
  const target = path.resolve(root, relativePath);
  if (!inside(path.resolve(root), target)) {
    throw new WorkerProvisioningError("WORKER_PATH_ESCAPE", "Worker path escapes its private root.");
  }
  await assertDirectory(root);
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new WorkerProvisioningError("WORKER_SYMLINK_REJECTED", "Worker path contains a symbolic link.");
      }
    } catch (error) {
      if (isNodeError(error, "ENOENT")) break;
      throw error;
    }
  }
  return target;
}
