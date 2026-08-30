import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import { localUserSchema, type LocalUser } from "@/auth/local-user-store";
import { parsePermissionMarkdown } from "@/permissions/markdown-parser";
import { readRegularFileWithin } from "@/security/safe-file";
import { atomicWriteFile, atomicWriteJson } from "@/storage/atomic-file";
import { ResourceLockManager } from "@/storage/resource-lock";
import { WorkerProvisioner } from "@/runtime/workers/provisioner";

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WORKER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export class UserProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "UserProvisioningError";
  }
}

export type UserProvisioningInput = {
  userId: string;
  email: string;
  displayName: string;
  enabled?: boolean;
  requireInitialPasswordChange?: boolean;
};

export type ProvisionedUser = {
  user: LocalUser;
  userRoot: string;
  created: boolean;
  workerId: string;
};

export type UserProvisionerOptions = {
  companyContextSeedRoot?: string;
};

type CompanyContextSeed = {
  directories: string[];
  files: Array<{ relativePath: string; contents: string }>;
};

const MAX_CONTEXT_SEED_FILES = 128;
const MAX_CONTEXT_SEED_FILE_BYTES = 256 * 1024;
const MAX_CONTEXT_SEED_BYTES = 2 * 1024 * 1024;

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return Boolean(
    error && typeof error === "object" && "code" in error
    && (code === undefined || (error as NodeJS.ErrnoException).code === code),
  );
}

function normalizeInput(input: UserProvisioningInput): LocalUser {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const workerId = `worker-${input.userId}`;
  if (!USER_ID_PATTERN.test(input.userId)) {
    throw new UserProvisioningError("USER_ID_INVALID", "userId must be a canonical lowercase UUID.");
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    throw new UserProvisioningError("USER_EMAIL_INVALID", "Email address is invalid.");
  }
  if (!displayName || displayName.length > 120 || /\p{C}/u.test(displayName)) {
    throw new UserProvisioningError("USER_DISPLAY_NAME_INVALID", "Display name is invalid.");
  }
  if (!WORKER_ID_PATTERN.test(workerId) || workerId.length > 63) {
    throw new UserProvisioningError("USER_WORKER_ID_INVALID", "workerId is invalid.");
  }
  return localUserSchema.parse({
    schemaVersion: 1,
    userId: input.userId,
    email,
    displayName,
    enabled: input.enabled ?? true,
    workerId,
  }, "user provisioning input");
}

function installationPolicy(config: Readonly<InstallationConfig>) {
  return [
    "---",
    "schemaVersion: 1",
    "policyVersion: 1",
    "scope: installation",
    `installationId: ${config.installationId}`,
    "---",
    "",
    "# Permissions",
    "",
    "## Rules",
    "",
    "- `documents.read` | consult | allow | Consult only documents exposed by the server for this employee.",
    "- `assistant.respond` | respond | allow | Respond within the authenticated employee and thread context.",
    "- `tools.execute` | execute | allow | Execute only server-approved tools inside the isolated worker.",
    "- `documents.publish` | publish | deny | Do not publish until an administrator grants an explicit user policy.",
    "",
  ].join("\n");
}

function userPolicy(config: Readonly<InstallationConfig>, userId: string) {
  return [
    "---",
    "schemaVersion: 1",
    "policyVersion: 1",
    "scope: user",
    `installationId: ${config.installationId}`,
    `userId: ${userId}`,
    "---",
    "",
    "# Permissions",
    "",
    "## Rules",
    "",
    "- `documents.publish` | publish | deny | Publishing requires an explicit user policy and the server confirmation flow.",
    "",
  ].join("\n");
}

function profile(user: LocalUser) {
  return [
    "# Employee profile",
    "",
    `- User ID: ${user.userId}`,
    `- Display name: ${user.displayName}`,
    `- Email: ${user.email}`,
    `- Worker ID: ${user.workerId}`,
    "",
  ].join("\n");
}

const DEFAULT_PREFERENCES = [
  "# Employee preferences",
  "",
  "No explicit preferences have been recorded.",
  "",
].join("\n");

function companyContextTemplates(config: Readonly<InstallationConfig>) {
  return new Map<string, string>([
    ["00_SYSTEM.md", [
      "# AiBrain system context",
      "",
      `This is the dedicated AiBrain installation for ${config.companyName}.`,
      "Treat this file as stable company context, not as employee-specific permissions.",
      "",
    ].join("\n")],
    ["10_IDENTITY.md", [
      "# Company identity",
      "",
      `- Company: ${config.companyName}`,
      `- Installation: ${config.installationId}`,
      `- Product: ${config.branding.productName}`,
      "",
    ].join("\n")],
    ["20_COMPANY.md", [
      "# Company context",
      "",
      "No additional company context has been recorded.",
      "",
    ].join("\n")],
    ["30_ORGANIZATION.md", [
      "# Organization",
      "",
      "No organization details have been recorded.",
      "",
    ].join("\n")],
    ["40_WORKFLOWS.md", [
      "# Company workflows",
      "",
      "No company workflows have been recorded.",
      "",
    ].join("\n")],
    ["50_DOCUMENT_RULES.md", [
      "# Document rules",
      "",
      "Documents are read from the server-approved source and staging paths.",
      "Official documents are published only through the explicit server-side confirmation flow.",
      "",
    ].join("\n")],
    ["KNOWLEDGE_INDEX.md", [
      "# Knowledge index",
      "",
      "Company knowledge is explicit and source-backed. No source has been indexed yet.",
      "",
      "## Locations",
      "",
      "- `knowledge/departments/`",
      "- `knowledge/procedures/`",
      "- `knowledge/glossary/`",
      "- `knowledge/sources/`",
      "",
    ].join("\n")],
  ]);
}

async function assertPrivateDirectory(directory: string) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new UserProvisioningError("USER_PATH_UNSAFE", "User path must be a real directory.");
  }
  await chmod(directory, 0o700);
}

async function ensurePrivateDirectory(directory: string) {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  await assertPrivateDirectory(directory);
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function ensureDescendantTree(root: string, target: string) {
  const canonicalRoot = await realpath(root);
  const relative = path.relative(root, target);
  if (!relative || !inside(root, target)) {
    throw new UserProvisioningError("USER_PATH_UNSAFE", "Provisioning path escapes dataRoot.");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    await ensurePrivateDirectory(current);
    if (!inside(canonicalRoot, await realpath(current))) {
      throw new UserProvisioningError("USER_PATH_UNSAFE", "Provisioning path resolves outside dataRoot.");
    }
  }
}

async function regularFileExists(filePath: string) {
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new UserProvisioningError("USER_PATH_UNSAFE", "Provisioned file must be regular.");
    }
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

async function createFileOnce(filePath: string, contents: string, mode: number) {
  if (await regularFileExists(filePath)) return false;
  await atomicWriteFile(filePath, contents, { mode });
  await chmod(filePath, mode);
  return true;
}

async function loadCompanyContextSeed(seedRoot: string): Promise<CompanyContextSeed> {
  const root = path.resolve(seedRoot);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new UserProvisioningError("COMPANY_CONTEXT_SEED_UNSAFE", "Company-context seed root must be a real directory.");
  }
  const canonicalRoot = await realpath(root);
  const directories: string[] = [];
  const files: CompanyContextSeed["files"] = [];
  let totalBytes = 0;

  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      const sourcePath = path.join(directory, entry.name);
      const metadata = await lstat(sourcePath);
      if (metadata.isSymbolicLink() || !inside(canonicalRoot, await realpath(sourcePath))) {
        throw new UserProvisioningError("COMPANY_CONTEXT_SEED_UNSAFE", "Company-context seed contains a path outside its root.");
      }
      if (metadata.isDirectory()) {
        directories.push(relativePath);
        await visit(sourcePath, relativePath);
        continue;
      }
      if (!metadata.isFile() || path.extname(entry.name) !== ".md" || metadata.size > MAX_CONTEXT_SEED_FILE_BYTES) {
        throw new UserProvisioningError("COMPANY_CONTEXT_SEED_UNSAFE", "Company-context seed must contain only bounded Markdown files.");
      }
      totalBytes += metadata.size;
      if (files.length >= MAX_CONTEXT_SEED_FILES || totalBytes > MAX_CONTEXT_SEED_BYTES) {
        throw new UserProvisioningError("COMPANY_CONTEXT_SEED_TOO_LARGE", "Company-context seed exceeds its bounded size.");
      }
      const contents = await readRegularFileWithin(root, relativePath, MAX_CONTEXT_SEED_FILE_BYTES);
      files.push({ relativePath, contents: contents.toString("utf8") });
    }
  };

  await visit(root, "");
  return { directories, files };
}

function sameUser(left: LocalUser, right: LocalUser) {
  return left.schemaVersion === right.schemaVersion
    && left.userId === right.userId
    && left.email === right.email
    && left.displayName === right.displayName
    && left.enabled === right.enabled
    && left.workerId === right.workerId;
}

export class UserProvisioner {
  private readonly lockManager: ResourceLockManager;
  private readonly workerProvisioner: WorkerProvisioner;

  constructor(
    readonly config: Readonly<InstallationConfig>,
    private readonly options: Readonly<UserProvisionerOptions> = {},
  ) {
    this.lockManager = new ResourceLockManager({
      rootDirectory: path.join(config.paths.dataRoot, "locks", "user-provisioning"),
    });
    this.workerProvisioner = new WorkerProvisioner({ config });
  }

  async ensureInstallationPolicy() {
    return this.lockManager.withLock(`installation-policy:${this.config.installationId}`, async () => {
      await ensurePrivateDirectory(this.config.paths.dataRoot);
      await ensureDescendantTree(this.config.paths.dataRoot, this.config.paths.companyContextRoot);
      if (this.options.companyContextSeedRoot) {
        const seed = await loadCompanyContextSeed(this.options.companyContextSeedRoot);
        for (const relativeDirectory of seed.directories) {
          await ensureDescendantTree(
            this.config.paths.companyContextRoot,
            path.join(this.config.paths.companyContextRoot, relativeDirectory),
          );
        }
        for (const file of seed.files) {
          await createFileOnce(
            path.join(this.config.paths.companyContextRoot, file.relativePath),
            file.contents,
            0o400,
          );
        }
      }
      const knowledgeRoot = path.join(this.config.paths.companyContextRoot, "knowledge");
      await ensurePrivateDirectory(knowledgeRoot);
      for (const directory of ["departments", "procedures", "glossary", "sources"]) {
        await ensurePrivateDirectory(path.join(knowledgeRoot, directory));
      }
      for (const [fileName, contents] of companyContextTemplates(this.config)) {
        const contextPath = path.join(this.config.paths.companyContextRoot, fileName);
        await createFileOnce(contextPath, contents, 0o400);
      }
      const policyPath = path.join(this.config.paths.companyContextRoot, "PERMISSIONS.md");
      const expected = installationPolicy(this.config);
      if (!await createFileOnce(policyPath, expected, 0o400)) {
        const contents = await readRegularFileWithin(
          this.config.paths.companyContextRoot,
          "PERMISSIONS.md",
          256 * 1024,
        );
        const parsed = parsePermissionMarkdown(contents.toString("utf8"));
        if (parsed.scope !== "installation" || parsed.installationId !== this.config.installationId) {
          throw new UserProvisioningError(
            "INSTALLATION_POLICY_MISMATCH",
            "Existing installation PERMISSIONS.md belongs to another installation.",
          );
        }
        await chmod(policyPath, 0o400);
      }
      return policyPath;
    });
  }

  async provision(input: UserProvisioningInput): Promise<ProvisionedUser> {
    const user = normalizeInput(input);
    await this.ensureInstallationPolicy();
    await ensureDescendantTree(this.config.paths.dataRoot, this.config.paths.usersRoot);
    return this.lockManager.withLock(
      `user-provision:${this.config.installationId}:${user.userId}`,
      async () => {
        const userRoot = path.join(this.config.paths.usersRoot, user.userId);
        await ensurePrivateDirectory(userRoot);
        const userJsonPath = path.join(userRoot, "user.json");
        const existed = await regularFileExists(userJsonPath);
        if (existed) {
          const contents = await readRegularFileWithin(
            this.config.paths.usersRoot,
            path.join(user.userId, "user.json"),
            32 * 1024,
          );
          const current = localUserSchema.parse(JSON.parse(contents.toString("utf8")), userJsonPath);
          if (!sameUser(current, user)) {
            throw new UserProvisioningError(
              "USER_ALREADY_EXISTS",
              "Existing local user differs from the requested immutable provisioning input.",
            );
          }
        }

        await this.workerProvisioner.provision(user.userId);
        await ensurePrivateDirectory(path.join(userRoot, "memory"));
        await createFileOnce(path.join(userRoot, "PROFILE.md"), profile(user), 0o400);
        await createFileOnce(path.join(userRoot, "PREFERENCES.md"), DEFAULT_PREFERENCES, 0o600);
        const permissionsPath = path.join(userRoot, "PERMISSIONS.md");
        if (!await createFileOnce(permissionsPath, userPolicy(this.config, user.userId), 0o400)) {
          const permissions = await readRegularFileWithin(
            this.config.paths.usersRoot,
            path.join(user.userId, "PERMISSIONS.md"),
            256 * 1024,
          );
          const parsed = parsePermissionMarkdown(permissions.toString("utf8"));
          if (
            parsed.scope !== "user" || parsed.userId !== user.userId
            || parsed.installationId !== this.config.installationId
          ) {
            throw new UserProvisioningError(
              "USER_POLICY_MISMATCH",
              "Existing user PERMISSIONS.md belongs to another user or installation.",
            );
          }
          await chmod(permissionsPath, 0o400);
        }
        if (!existed && (input.requireInitialPasswordChange ?? true)) {
          await createFileOnce(path.join(userRoot, "password-change-required"), `${randomUUID()}\n`, 0o600);
        }
        if (!existed) {
          await atomicWriteJson(userJsonPath, user, localUserSchema, { mode: 0o600 });
          await chmod(userJsonPath, 0o600);
        }
        return {
          user,
          userRoot,
          created: !existed,
          workerId: user.workerId,
        };
      },
    );
  }
}
