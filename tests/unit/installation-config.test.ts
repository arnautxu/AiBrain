import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  loadInstallationConfig,
  loadInstallationConfigFromFile,
  resolveInstallationConfigPath,
} from "@/config/installation";
import {
  InstallationConfigValidationError,
  parseInstallationConfig,
} from "@/config/installation-schema";

const repositoryRoot = process.cwd();
const developmentFixture = path.join(
  repositoryRoot,
  "config/installations/development.example.json",
);
const qaFixture = path.join(repositoryRoot, "config/installations/qa.example.json");
const execFile = promisify(execFileCallback);

async function readFixture() {
  return JSON.parse(await readFile(developmentFixture, "utf8")) as Record<string, unknown>;
}

describe("InstallationConfig", () => {
  it("loads two genuinely different white-label installations", async () => {
    const development = await loadInstallationConfigFromFile(developmentFixture);
    const qa = await loadInstallationConfigFromFile(qaFixture);

    expect(development.schemaVersion).toBe(1);
    expect(qa.schemaVersion).toBe(1);
    expect(qa.installationId).not.toBe(development.installationId);
    expect(qa.companyName).not.toBe(development.companyName);
    expect(qa.publicUrl).not.toBe(development.publicUrl);
    expect(qa.branding).not.toEqual(development.branding);
    expect(qa.paths).not.toEqual(development.paths);
    expect(JSON.stringify([development, qa]).toLowerCase()).not.toMatch(/arnay|arnall|arnau/);
  });

  it("returns immutable normalized data", async () => {
    const config = await loadInstallationConfigFromFile(developmentFixture);

    expect(config.publicUrl).toBe("http://localhost:3000");
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.branding)).toBe(true);
    expect(Object.isFrozen(config.paths)).toBe(true);
  });

  it("rejects unknown fields at every configuration boundary", async () => {
    const fixture = await readFixture();
    const branding = fixture.branding as Record<string, unknown>;
    fixture.unexpected = true;
    branding.legacyTenant = "studio";

    expect(() => parseInstallationConfig(fixture)).toThrowError(
      expect.objectContaining<Partial<InstallationConfigValidationError>>({
        issues: expect.arrayContaining([
          { path: "$.unexpected", message: "campo desconocido" },
          { path: "$.branding.legacyTenant", message: "campo desconocido" },
        ]),
      }),
    );
  });

  it("rejects unsupported versions, insecure URLs and unsafe filesystem roots", async () => {
    const fixture = await readFixture();
    fixture.schemaVersion = 2;
    fixture.publicUrl = "http://brain.example.test/admin?token=1";
    fixture.paths = {
      ...(fixture.paths as Record<string, unknown>),
      dataRoot: "/",
      companyContextRoot: "/etc/aibrain-company",
      sourceReadRoot: "/mnt/company",
      publishWriteRoot: "/mnt/company/publish",
    };

    expect(() => parseInstallationConfig(fixture)).toThrowError(
      expect.objectContaining<Partial<InstallationConfigValidationError>>({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "$.schemaVersion" }),
          expect.objectContaining({ path: "$.publicUrl" }),
          expect.objectContaining({ path: "$.paths.dataRoot" }),
          expect.objectContaining({ path: "$.paths.publishWriteRoot" }),
        ]),
      }),
    );
  });

  it("fails closed when production has no absolute config path", () => {
    expect(() => resolveInstallationConfigPath({ env: { NODE_ENV: "production" } })).toThrow(
      "AIBRAIN_INSTALLATION_CONFIG es obligatorio en producción.",
    );
    expect(() => resolveInstallationConfigPath({
      env: {
        NODE_ENV: "production",
        AIBRAIN_INSTALLATION_CONFIG: "config/installations/qa.example.json",
      },
    })).toThrow("AIBRAIN_INSTALLATION_CONFIG debe ser una ruta absoluta.");
  });

  it("uses the synthetic development fixture only outside production", async () => {
    const loaded = await loadInstallationConfig({
      cwd: repositoryRoot,
      env: { NODE_ENV: "test" },
    });

    expect(loaded.installationId).toBe("example-lab-dev");
  });

  it("rejects symlinked configuration files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aibrain-installation-"));
    const target = path.join(directory, "target.json");
    const link = path.join(directory, "installation.json");
    await writeFile(target, await readFile(developmentFixture));
    await symlink(target, link);

    await expect(loadInstallationConfigFromFile(link)).rejects.toThrow(
      "InstallationConfig no puede ser un enlace simbólico.",
    );
  });

  it("creates a new installation through the operational command", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aibrain-installation-generator-"));
    const output = path.join(directory, "generated.json");
    try {
      await execFile(process.execPath, [
        path.join(repositoryRoot, "scripts/create-installation.mjs"),
        "--installation-id", "acme-test",
        "--company-name", "Acme Test Company",
        "--company-slug", "acme-test",
        "--public-url", "https://brain.acme.test",
        "--product-name", "Acme Brain",
        "--accent-color", "#123abc",
        "--data-root", "/srv/aibrain-acme-test/data",
        "--source-read-root", "/mnt/aibrain-acme-test/source-ro",
        "--publish-write-root", "/mnt/aibrain-acme-test/publish-rw",
        "--output", output,
      ], { cwd: repositoryRoot });

      const generated = await loadInstallationConfigFromFile(output);
      expect(generated).toMatchObject({
        schemaVersion: 1,
        installationId: "acme-test",
        companySlug: "acme-test",
        branding: {
          productName: "Acme Brain",
          logoPath: "/branding/acme-test/logo.svg",
          accentColor: "#123abc",
        },
        paths: {
          dataRoot: "/srv/aibrain-acme-test/data",
          usersRoot: "/srv/aibrain-acme-test/data/users",
        },
      });
      await expect(execFile(process.execPath, [
        path.join(repositoryRoot, "scripts/create-installation.mjs"),
        "--installation-id", "acme-test",
        "--company-name", "Acme Test Company",
        "--company-slug", "acme-test",
        "--public-url", "https://brain.acme.test",
        "--product-name", "Acme Brain",
        "--accent-color", "#123abc",
        "--data-root", "/srv/aibrain-acme-test/data",
        "--source-read-root", "/mnt/aibrain-acme-test/source-ro",
        "--publish-write-root", "/mnt/aibrain-acme-test/publish-rw",
        "--output", output,
      ], { cwd: repositoryRoot })).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
