import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectiveWorkspacePolicy, FileWorkspaceAdminStore } from "@/admin/workspace-admin-store";

const ownerId = "00000000-0000-4000-8000-000000000001";
const memberId = "00000000-0000-4000-8000-000000000002";
let root = "";
let previousAdmins: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aibrain-admin-"));
  previousAdmins = process.env.AIBRAIN_ADMIN_USER_IDS;
  process.env.AIBRAIN_ADMIN_USER_IDS = ownerId;
});

afterEach(async () => {
  if (previousAdmins === undefined) delete process.env.AIBRAIN_ADMIN_USER_IDS;
  else process.env.AIBRAIN_ADMIN_USER_IDS = previousAdmins;
  await rm(root, { recursive: true, force: true });
});

describe("FileWorkspaceAdminStore", () => {
  it("persists roles and groups, applies group restrictions deny-wins and audits the actor", async () => {
    const store = new FileWorkspaceAdminStore("example-qa", root, () => Date.parse("2026-08-28T10:00:00.000Z"));
    const initial = await store.read([ownerId, memberId]);
    expect(initial.assignments).toEqual([
      { userId: ownerId, roleId: "workspace-owner" },
      { userId: memberId, roleId: "workspace-member" },
    ]);

    const state = await store.mutate([ownerId, memberId], ownerId, (current) => {
      const group = store.newGroup("Finanzas", "Acceso de consulta");
      group.memberIds = [memberId];
      group.policy.apps["managed-browser"] = false;
      group.policy.capabilities.execute = false;
      current.groups.push(group);
      return { action: "group.created", targetType: "group", targetId: group.id, summary: "Grupo creado." };
    });
    const effective = effectiveWorkspacePolicy(state, memberId);
    expect(effective.policy.apps["managed-browser"]).toBe(false);
    expect(effective.policy.capabilities.execute).toBe(false);
    expect(effective.policy.capabilities.consult).toBe(true);

    const reloaded = await new FileWorkspaceAdminStore("example-qa", root).read([ownerId, memberId]);
    expect(reloaded.groups).toHaveLength(1);
    const audit = await store.auditLog();
    expect(audit).toMatchObject([{ sequence: 1, actorUserId: ownerId, action: "group.created", installationId: "example-qa" }]);
  });

  it("rejects state reuse across tenants", async () => {
    await new FileWorkspaceAdminStore("example-qa", root).read([ownerId]);
    await expect(new FileWorkspaceAdminStore("other-qa", root).read([ownerId]))
      .rejects.toThrow("another installation");
  });
});
