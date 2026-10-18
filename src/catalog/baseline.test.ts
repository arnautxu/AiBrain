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
    fixture.connectors = { ...(fixture.connectors as object), companyMail: { enabled: true, host: "imap.example.test", emailDomain: "arnall.cat" } };
    const installation = parseInstallationConfig(fixture);
    const state = await ensureInstallationCatalog(
      new FileCatalogStore(installation.installationId, installation.paths.dataRoot),
      installation,
    );

    expect(state.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "company-mail", credentialMode: "personal-credential", sharedResource: false }),
      expect.objectContaining({ id: "gmail", credentialMode: "personal-oauth", connectorId: "gmail" }),
      expect.objectContaining({ id: "outlook", credentialMode: "personal-oauth", connectorId: "outlook" }),
    ]));
    expect(state.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "installation-company-mail", effect: "allow", operations: ["read"] }),
      expect.objectContaining({ id: "installation-gmail", effect: "allow", operations: ["read"] }),
      expect.objectContaining({ id: "installation-outlook", effect: "allow", operations: ["read"] }),
    ]));
    expect(state.resources.some(resource => resource.id === "mail")).toBe(false);
    const mailConfig = parseInstallationConfig({ ...fixture, connectors: { mail: { enabled: true, provider: "nominalia" } } });
    const mailStore = new FileCatalogStore(mailConfig.installationId, mailConfig.paths.dataRoot);
    const enabled = await ensureInstallationCatalog(mailStore, mailConfig);
    expect(enabled.rules.find(rule => rule.id === "installation-mail")?.operations).toEqual(["read", "write"]);
    await mailStore.mutate("11111111-1111-4111-8111-111111111111", current => {
      const rule = current.rules.find(rule => rule.id === "installation-mail")!;
      rule.operations = ["read"];
      return { action: "catalog.rule-set", targetId: rule.id, summary: "Restrict personal mail to read access" };
    });
    const restricted = await ensureInstallationCatalog(mailStore, mailConfig);
    expect(restricted.rules.find(rule => rule.id === "installation-mail")?.operations).toEqual(["read"]);
  });
});

it("adds company-qa optional mailboxes only when configured and does so idempotently", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "company-qa-catalog-"));
  roots.push(root);
  const fixture = JSON.parse(await readFile(path.join(process.cwd(), "config/installations/arnall.qa.example.json"), "utf8"));
  fixture.installationId = "company-qa";
  delete fixture.connectors;
  fixture.paths = {
    dataRoot: path.join(root, "data"), companyContextRoot: path.join(root, "data/company-context"),
    usersRoot: path.join(root, "data/users"), backupsRoot: path.join(root, "data/backups"),
    sourceReadRoot: path.join(root, "source-ro"), publishWriteRoot: path.join(root, "publish-rw"),
  };
  const installation = parseInstallationConfig(fixture);
  const store = new FileCatalogStore(installation.installationId, installation.paths.dataRoot);
  const state = await ensureInstallationCatalog(store, installation);
  expect(state.resources.filter(resource => resource.kind === "connector")).toEqual([]);
  expect((await ensureInstallationCatalog(store, installation)).revision).toBe(state.revision);
  const configured = parseInstallationConfig({ ...fixture, connectors: { gmail: { enabled: true }, outlook: { enabled: true } } });
  const enabled = await ensureInstallationCatalog(store, configured);
  expect(enabled.resources.filter(resource => resource.kind === "connector").map(resource => resource.id).sort()).toEqual(["gmail", "outlook"]);
  expect((await ensureInstallationCatalog(store, configured)).revision).toBe(enabled.revision);
});
