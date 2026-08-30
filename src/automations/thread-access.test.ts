import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileWorkspaceAdminStore } from "@/admin/workspace-admin-store";
import type { AuthSession } from "@/auth/types";
import { FileAutomationAudienceStore } from "@/automations/audience-store";
import { FileAutomationStore } from "@/automations/store";
import { automationRunsForSession, listAutomationTasks } from "@/automations/server-service";
import { loadInstallationConfig } from "@/config/installation";
import type { ChatMessage } from "@/lib/chat-contract";
import { getTaskCenter } from "@/task-center/server-service";
import { UserProvisioner } from "@/users/provisioner";
import { beginThreadTurn, createProject, createThread, finishThreadTurn, updateProject } from "@/workbench/store";
import { loadSharedWorkbench, resolveThreadAccess } from "@/workbench/shared-access";

vi.mock("server-only", () => ({}));

const ownerId = "00000000-0000-4000-8000-000000000011";
const memberId = "00000000-0000-4000-8000-000000000012";
const outsiderId = "00000000-0000-4000-8000-000000000013";
let root = "";
let previousConfig: string | undefined;
let previousAdmins: string | undefined;

function session(userId: string, email: string, name: string): AuthSession {
  return {
    provider: "local",
    user: { id: userId, email, name },
    tenant: { id: "automation-audience-qa", name: "Automation Audience QA" },
    expiresAt: "2026-08-31T00:00:00.000Z",
  };
}

function message(id: string, role: ChatMessage["role"], content: string, status: ChatMessage["status"], createdAt: string): ChatMessage {
  return { id, role, content, status, createdAt, activity: [], plan: [], approvals: [], diff: "", attachments: [], artifacts: [], sources: [], toolResults: [] };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aibrain-automation-thread-access-"));
  const dataRoot = path.join(root, "data");
  await mkdir(dataRoot, { mode: 0o700 });
  const configPath = path.join(root, "installation.json");
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    installationId: "automation-audience-qa",
    companyName: "Automation Audience QA",
    companySlug: "automation-audience-qa",
    publicUrl: "http://localhost:3000",
    branding: { productName: "AiBrain", logoPath: "/logo.svg", faviconPath: "/favicon.ico", accentColor: "#111111" },
    paths: {
      dataRoot,
      companyContextRoot: path.join(dataRoot, "company"),
      usersRoot: path.join(dataRoot, "users"),
      sourceReadRoot: path.join(root, "source"),
      publishWriteRoot: path.join(root, "publish"),
      backupsRoot: path.join(dataRoot, "backups"),
    },
  }));
  previousConfig = process.env.AIBRAIN_INSTALLATION_CONFIG;
  previousAdmins = process.env.AIBRAIN_ADMIN_USER_IDS;
  process.env.AIBRAIN_INSTALLATION_CONFIG = configPath;
  process.env.AIBRAIN_ADMIN_USER_IDS = ownerId;
});

afterEach(async () => {
  if (previousConfig === undefined) delete process.env.AIBRAIN_INSTALLATION_CONFIG;
  else process.env.AIBRAIN_INSTALLATION_CONFIG = previousConfig;
  if (previousAdmins === undefined) delete process.env.AIBRAIN_ADMIN_USER_IDS;
  else process.env.AIBRAIN_ADMIN_USER_IDS = previousAdmins;
  await rm(root, { recursive: true, force: true });
});

describe("automation result thread audience", () => {
  it("delivers one offline result notification to current group members and revokes it after removal", async () => {
    const installation = await loadInstallationConfig();
    const provisioner = new UserProvisioner(installation);
    await provisioner.provision({ userId: ownerId, email: "owner@example.com", displayName: "Owner" });
    await provisioner.provision({ userId: memberId, email: "member@example.com", displayName: "Member" });
    await provisioner.provision({ userId: outsiderId, email: "outsider@example.com", displayName: "Outsider" });
    const ownerSession = session(ownerId, "owner@example.com", "Owner");
    const memberSession = session(memberId, "member@example.com", "Member");
    const outsiderSession = session(outsiderId, "outsider@example.com", "Outsider");

    const admin = new FileWorkspaceAdminStore(installation.installationId, installation.paths.dataRoot);
    const userIds = [ownerId, memberId, outsiderId];
    await admin.read(userIds);
    const state = await admin.mutate(userIds, ownerId, (current) => {
      const group = admin.newGroup("Operaciones", "Recibe el informe programado");
      group.memberIds = [memberId];
      current.groups.push(group);
      return { action: "group.created", targetType: "group", targetId: group.id, summary: "Grupo creado." };
    });
    const groupId = state.groups[0]!.id;
    const project = await createProject(ownerSession, "Operaciones");
    await updateProject(ownerSession, project.id, {
      sharing: {
        visibility: "shared",
        members: [{
          id: "00000000-0000-4000-8000-000000000014",
          email: "outsider@example.com",
          name: "Outsider",
          role: "viewer",
          status: "active",
          addedAt: "2026-08-30T08:30:00.000Z",
        }],
      },
    });
    const thread = await createThread(ownerSession, project.id, "Programada · Informe");
    const userMessage = message("40000000-0000-4000-8000-000000000001", "user", "Prepara el informe.", "complete", "2026-08-30T09:00:00.000Z");
    const assistantMessage = message("40000000-0000-4000-8000-000000000002", "assistant", "Informe preparado.", "complete", "2026-08-30T09:00:01.000Z");
    await beginThreadTurn(ownerSession, thread.id, userMessage, { ...assistantMessage, status: "streaming" });
    await finishThreadTurn(ownerSession, thread.id, assistantMessage, null);

    const automationStore = new FileAutomationStore({
      installationId: installation.installationId,
      userId: ownerId,
      usersRoot: installation.paths.usersRoot,
    });
    const automation = await automationStore.create({
      name: "Informe",
      prompt: "Prepara el informe.",
      projectId: project.id,
      projectName: project.name,
      timeZone: "Europe/Madrid",
      schedule: { kind: "once", runAt: "2030-08-30T09:00:00.000Z" },
      audience: { membershipPolicy: "current", userIds: [], groupIds: [groupId] },
    });
    const runKey = `${automation.id}:2030-08-30T09:00:00.000Z`;
    await automationStore.appendRun({
      schemaVersion: 1,
      runKey,
      taskId: automation.id,
      installationId: installation.installationId,
      userId: ownerId,
      scheduledFor: "2030-08-30T09:00:00.000Z",
      status: "succeeded",
      attempt: 1,
      startedAt: "2026-08-30T09:00:00.000Z",
      finishedAt: "2026-08-30T09:00:01.000Z",
      threadId: thread.id,
      error: null,
    });
    await new FileAutomationAudienceStore({
      installationId: installation.installationId,
      dataRoot: installation.paths.dataRoot,
    }).record({ runKey, taskId: automation.id, ownerUserId: ownerId, projectId: project.id, threadId: thread.id });

    await expect(resolveThreadAccess(memberSession, thread.id)).resolves.toMatchObject({
      role: "viewer",
      provenance: { source: "automation-audience", taskId: automation.id, membershipPolicy: "current" },
    });
    expect((await loadSharedWorkbench(memberSession)).threads.map(({ id }) => id)).toContain(thread.id);
    expect((await getTaskCenter(memberSession)).tasks).toMatchObject([{ threadId: thread.id, unread: true }]);
    expect((await listAutomationTasks(memberSession)).tasks).toMatchObject([{ id: automation.id, access: { canManage: false, canViewResults: true } }]);
    expect(await automationRunsForSession(memberSession, automation.id)).toHaveLength(1);
    expect((await listAutomationTasks(ownerSession)).tasks).toMatchObject([{ id: automation.id, access: { canManage: true, canViewResults: true } }]);
    await expect(resolveThreadAccess(ownerSession, thread.id)).resolves.toMatchObject({ role: "owner" });
    expect((await getTaskCenter(ownerSession)).tasks).toHaveLength(1);
    expect((await listAutomationTasks(outsiderSession)).tasks).toEqual([]);
    await expect(resolveThreadAccess(outsiderSession, thread.id)).rejects.toThrow("Fil no trobat");
    expect((await loadSharedWorkbench(outsiderSession)).threads.map(({ id }) => id)).not.toContain(thread.id);
    await expect(listAutomationTasks({ ...memberSession, tenant: { id: "foreign-qa", name: "Foreign" } }))
      .rejects.toMatchObject({ code: "AUTOMATION_TENANT_MISMATCH" });

    await admin.mutate(userIds, ownerId, (current) => {
      const group = current.groups.find(({ id }) => id === groupId)!;
      group.memberIds = [];
      group.updatedAt = new Date(Math.max(Date.now(), Date.parse(group.createdAt)) + 1).toISOString();
      return { action: "group.updated", targetType: "group", targetId: group.id, summary: "Miembro retirado." };
    });
    await expect(resolveThreadAccess(memberSession, thread.id)).rejects.toThrow("Fil no trobat");
    expect((await getTaskCenter(memberSession)).tasks).toEqual([]);
    expect((await listAutomationTasks(memberSession)).tasks).toEqual([]);
    await expect(automationRunsForSession(memberSession, automation.id))
      .rejects.toMatchObject({ code: "AUTOMATION_NOT_FOUND" });
  });
});
