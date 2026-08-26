import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLocalUserStore } from "@/auth/local-user-store";
import { parseInstallationConfig } from "@/config/installation-schema";
import { parsePermissionMarkdown } from "@/permissions/markdown-parser";
import { UserProvisioner } from "@/users/provisioner";

const roots: string[] = [];

function userId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-user-provisioning-"));
  roots.push(root);
  const config = parseInstallationConfig({
    schemaVersion: 1,
    installationId: "synthetic-company-qa",
    companyName: "Synthetic Company QA",
    companySlug: "synthetic-company",
    publicUrl: "http://127.0.0.1:3000",
    branding: {
      productName: "Synthetic Brain",
      logoPath: "/branding/synthetic/logo.svg",
      faviconPath: "/branding/synthetic/favicon.svg",
      accentColor: "#315ee7",
    },
    paths: {
      dataRoot: path.join(root, "data"),
      companyContextRoot: path.join(root, "data", "company"),
      usersRoot: path.join(root, "data", "users"),
      sourceReadRoot: path.join(root, "documents", "source-ro"),
      publishWriteRoot: path.join(root, "documents", "publish-rw"),
      backupsRoot: path.join(root, "data", "backups"),
    },
  });
  return { root, config, provisioner: new UserProvisioner(config) };
}

async function mode(filePath: string) {
  return (await lstat(filePath)).mode & 0o777;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("UserProvisioner", () => {
  it("provisions twenty complete employee roots without code or configuration changes", async () => {
    const { config, provisioner } = await fixture();
    const inputs = Array.from({ length: 20 }, (_, index) => ({
      userId: userId(index + 1),
      email: `employee-${index + 1}@example.test`,
      displayName: `Synthetic Employee ${index + 1}`,
    }));

    const results = await Promise.all(inputs.map((input) => provisioner.provision(input)));
    expect(results.every(({ created }) => created)).toBe(true);
    expect(new Set(results.map(({ userRoot }) => userRoot))).toHaveLength(20);
    expect(new Set(results.map(({ workerId }) => workerId))).toHaveLength(20);

    const users = new FileLocalUserStore(config.paths.usersRoot);
    for (const input of inputs) {
      const root = path.join(config.paths.usersRoot, input.userId);
      expect(await users.read(input.userId)).toMatchObject({
        email: input.email,
        enabled: true,
        workerId: `worker-${input.userId}`,
      });
      expect(await mode(root)).toBe(0o700);
      expect(await mode(path.join(root, "user.json"))).toBe(0o600);
      expect(await mode(path.join(root, "PROFILE.md"))).toBe(0o400);
      expect(await mode(path.join(root, "PERMISSIONS.md"))).toBe(0o400);
      expect(await mode(path.join(root, "PREFERENCES.md"))).toBe(0o600);
      expect(await mode(path.join(root, "password-change-required"))).toBe(0o600);
      expect(await lstat(path.join(root, "worker.json"))).toBeTruthy();
    }

    const installationPolicy = parsePermissionMarkdown(
      await readFile(path.join(config.paths.companyContextRoot, "PERMISSIONS.md"), "utf8"),
    );
    expect(installationPolicy).toMatchObject({
      installationId: config.installationId,
      scope: "installation",
    });
    expect(await mode(path.join(config.paths.companyContextRoot, "PERMISSIONS.md"))).toBe(0o400);
  }, 20_000);

  it("is idempotent and never recreates a consumed initial-password marker", async () => {
    const { config, provisioner } = await fixture();
    const input = {
      userId: userId(1),
      email: "employee@example.test",
      displayName: "Synthetic Employee",
    };
    const first = await provisioner.provision(input);
    const marker = path.join(first.userRoot, "password-change-required");
    await unlink(marker);

    const second = await provisioner.provision(input);
    expect(second.created).toBe(false);
    await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(config.paths.usersRoot, input.userId, "user.json"), "utf8"))
      .toContain("employee@example.test");
  });

  it("fails closed for identity drift and symlink substitution", async () => {
    const { root, config, provisioner } = await fixture();
    const input = {
      userId: userId(1),
      email: "employee@example.test",
      displayName: "Synthetic Employee",
    };
    await provisioner.provision(input);
    await expect(provisioner.provision({ ...input, displayName: "Changed identity" }))
      .rejects.toMatchObject({ code: "USER_ALREADY_EXISTS" });

    const outside = path.join(root, "outside");
    await mkdir(outside);
    await chmod(outside, 0o700);
    await symlink(outside, path.join(config.paths.usersRoot, userId(2)));
    await expect(provisioner.provision({
      userId: userId(2),
      email: "other@example.test",
      displayName: "Other Employee",
    })).rejects.toMatchObject({ code: "USER_PATH_UNSAFE" });
  });
});
