import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InstallationConfig } from "@/config/installation-schema";
import type { CatalogPrincipal, CatalogState } from "@/catalog/contracts";
import { FileCompanySkillPackageStore, synchronizeEffectiveSkills } from "@/catalog/skill-packages";

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const GROUP = "00000000-0000-4000-8000-000000000003";
const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-skill-sync-")); roots.push(root);
  const dataRoot = path.join(root, "data"); const usersRoot = path.join(dataRoot, "users");
  await mkdir(usersRoot, { recursive: true, mode: 0o700 });
  for (const userId of [USER_A, USER_B]) await mkdir(path.join(usersRoot, userId, "runtime", "codex-home"), { recursive: true, mode: 0o700 });
  const config = {
    schemaVersion: 1, installationId: "arnall-qa", companyName: "Arnall", companySlug: "arnall", publicUrl: "https://arnall.example",
    branding: { productName: "Arnall AI", logoPath: "/logo.svg", faviconPath: "/favicon.svg", accentColor: "#315ee7" },
    paths: { dataRoot, usersRoot, companyContextRoot: path.join(dataRoot, "company"), sourceReadRoot: path.join(root, "source"), publishWriteRoot: path.join(root, "publish"), backupsRoot: path.join(dataRoot, "backups") },
    catalog: { graphikAIManagedSkills: [{ id: "graphikai-business-work", label: "Trabajo empresarial GraphikAI" }, { id: "arnall-company-brief", label: "Contexto confirmado de Arnall" }] },
  } satisfies InstallationConfig;
  const resources = ["graphikai-business-work", "arnall-company-brief"].map((id) => ({ id, kind: "skill" as const, label: id, credentialMode: "none" as const, managedBy: "graphikai" as const, sharedResource: false, appId: null, connectorId: null, mcp: null }));
  const state: CatalogState = { schemaVersion: 1, installationId: config.installationId, revision: 1, resources, rules: resources.map(({ id }) => ({ id: `install-${id}`, scope: "installation" as const, subjectId: null, resourceId: id, effect: "allow" as const, operations: ["read" as const] })) };
  const principal = (userId: string, groupIds: string[] = []): CatalogPrincipal => ({ installationId: config.installationId, userId, roleId: "workspace-member", groupIds, workspaceCanExecute: true });
  return { root, config, state, principal, packagesRoot: path.join(process.cwd(), "skills") };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("managed skill packages", () => {
  it("synchronizes the Arnall shared seed into two separate private CODEX_HOME roots", async () => {
    const { config, state, principal, packagesRoot } = await fixture();
    const first = await synchronizeEffectiveSkills({ config, userId: USER_A, state, principal: principal(USER_A), packagesRoot });
    const second = await synchronizeEffectiveSkills({ config, userId: USER_B, state, principal: principal(USER_B), packagesRoot });
    expect(first.installed.sort()).toEqual(["arnall-company-brief", "graphikai-business-work"]);
    expect(second.installed.sort()).toEqual(first.installed.sort());
    expect(first.skills[0].path).not.toBe(second.skills[0].path);
    expect(await readFile(path.join(config.paths.usersRoot, USER_A, "runtime", "codex-home", "skills", "arnall-company-brief", "SKILL.md"), "utf8")).toContain("Never invent stock");
    expect((await synchronizeEffectiveSkills({ config, userId: USER_A, state, principal: principal(USER_A), packagesRoot })).unchanged).toHaveLength(2);
  });

  it("adds, updates and revokes a group skill idempotently as membership changes", async () => {
    const { config, state, principal, packagesRoot } = await fixture();
    const store = new FileCompanySkillPackageStore(config.installationId, config.paths.dataRoot, () => Date.parse("2026-08-30T10:00:00.000Z"));
    const input = (version: string, body: string) => ({ id: "arnall-sales-check", label: "Comprobación comercial", version, category: "company" as const, provenance: "Procedimiento confirmado por administración el 2026-08-30.", files: [{ path: "SKILL.md", content: `---\nname: arnall-sales-check\ndescription: Check confirmed sales inputs.\n---\n\n${body}` }] });
    expect((await store.upsert(USER_A, input("1.0.0", "Versión uno"))).changed).toBe(true);
    await expect(store.upsert(USER_A, input("1.0.1", "password=abcdefghijklmnop"))).rejects.toMatchObject({ code: "SKILL_PACKAGE_SECRET_REJECTED" });
    expect((await store.upsert(USER_A, input("1.0.0", "Versión uno"))).changed).toBe(false);
    state.resources.push({ id: "arnall-sales-check", kind: "skill", label: "Comprobación comercial", credentialMode: "none", managedBy: "company", sharedResource: false, appId: null, connectorId: null, mcp: null });
    state.rules.push({ id: "group-sales", scope: "group", subjectId: GROUP, resourceId: "arnall-sales-check", effect: "allow", operations: ["read"] }); state.revision += 1;
    const added = await synchronizeEffectiveSkills({ config, userId: USER_A, state, principal: principal(USER_A, [GROUP]), packagesRoot });
    expect(added.installed).toContain("arnall-sales-check");
    await store.upsert(USER_A, input("1.1.0", "Versión dos"));
    expect((await synchronizeEffectiveSkills({ config, userId: USER_A, state, principal: principal(USER_A, [GROUP]), packagesRoot })).updated).toEqual(["arnall-sales-check"]);
    expect((await synchronizeEffectiveSkills({ config, userId: USER_A, state, principal: principal(USER_A), packagesRoot })).revoked).toEqual(["arnall-sales-check"]);
    await store.revoke(USER_A, "arnall-sales-check");
    expect((await synchronizeEffectiveSkills({ config, userId: USER_B, state, principal: principal(USER_B, [GROUP]), packagesRoot })).skills.map(({ id }) => id)).not.toContain("arnall-sales-check");
    expect((await store.auditLog()).map(({ action }) => action)).toEqual(["skill-package.revoked", "skill-package.updated", "skill-package.updated"]);
  });

  it("fails closed on tenant mismatch and a symlinked employee CODEX_HOME", async () => {
    const { root, config, state, principal, packagesRoot } = await fixture();
    await expect(synchronizeEffectiveSkills({ config, userId: USER_A, state, principal: { ...principal(USER_A), installationId: "other-tenant" }, packagesRoot })).rejects.toMatchObject({ code: "SKILL_SYNC_IDENTITY_MISMATCH" });
    const codexHome = path.join(config.paths.usersRoot, USER_A, "runtime", "codex-home"); await rm(codexHome, { recursive: true }); await symlink(path.join(root, "outside"), codexHome);
    await expect(synchronizeEffectiveSkills({ config, userId: USER_A, state, principal: principal(USER_A), packagesRoot })).rejects.toBeInstanceOf(Error);
  });
});
