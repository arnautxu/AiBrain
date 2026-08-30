import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureInstallationCatalog } from "@/catalog/baseline";
import { FileCatalogStore } from "@/catalog/store";
import { parseInstallationConfig } from "@/config/installation-schema";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("installation catalog baseline", () => {
  it("publishes Arnall Gmail and Outlook only through effective catalog grants", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "arnall-catalog-"));
    roots.push(root);
    const fixture = JSON.parse(await readFile(path.join(process.cwd(), "config/installations/arnall.qa.example.json"), "utf8")) as Record<string, unknown>;
    fixture.paths = {
      dataRoot: path.join(root, "data"),
      companyContextRoot: path.join(root, "data/company-context"),
      usersRoot: path.join(root, "data/users"),
      sourceReadRoot: path.join(root, "source-ro"),
      publishWriteRoot: path.join(root, "publish-rw"),
      backupsRoot: path.join(root, "data/backups"),
    };
    const installation = parseInstallationConfig(fixture);
    const state = await ensureInstallationCatalog(
      new FileCatalogStore(installation.installationId, installation.paths.dataRoot),
      installation,
    );

    expect(state.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "gmail", credentialMode: "personal-oauth", connectorId: "gmail" }),
      expect.objectContaining({ id: "outlook", credentialMode: "personal-oauth", connectorId: "outlook" }),
    ]));
    expect(state.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "installation-gmail", effect: "allow", operations: ["read"] }),
      expect.objectContaining({ id: "installation-outlook", effect: "allow", operations: ["read"] }),
    ]));
  });
});
