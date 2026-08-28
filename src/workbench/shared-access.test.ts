import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/auth/types";
import { loadInstallationConfig } from "@/config/installation";
import { UserProvisioner } from "@/users/provisioner";
import { FileWorkbenchStore } from "@/workbench/filesystem-store";
import { loadSharedWorkbench, resolveProjectAccess } from "@/workbench/shared-access";

vi.mock("server-only", () => ({}));

const ownerId = "00000000-0000-4000-8000-000000000011";
const memberId = "00000000-0000-4000-8000-000000000012";
let root = "";
let previousConfig: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aibrain-shared-"));
  const dataRoot = path.join(root, "data");
  await mkdir(dataRoot, { mode: 0o700 });
  const configPath = path.join(root, "installation.json");
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    installationId: "shared-qa",
    companyName: "Shared QA",
    companySlug: "shared-qa",
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
  process.env.AIBRAIN_INSTALLATION_CONFIG = configPath;
});

afterEach(async () => {
  if (previousConfig === undefined) delete process.env.AIBRAIN_INSTALLATION_CONFIG;
  else process.env.AIBRAIN_INSTALLATION_CONFIG = previousConfig;
  await rm(root, { recursive: true, force: true });
});

describe("shared project visibility", () => {
  it("shows a shared project only to a provisioned member with matching email", async () => {
    const installation = await loadInstallationConfig();
    const provisioner = new UserProvisioner(installation);
    await provisioner.provision({ userId: ownerId, email: "owner@example.com", displayName: "Owner" });
    await provisioner.provision({ userId: memberId, email: "member@example.com", displayName: "Member" });
    const store = FileWorkbenchStore.fromInstallation(installation);
    const project = await store.createProject(ownerId, "Plan compartido");
    await store.updateProject(ownerId, project.id, {
      sharing: {
        visibility: "shared",
        members: [{
          id: "00000000-0000-4000-8000-000000000013",
          email: "member@example.com",
          name: "Member",
          role: "viewer",
          status: "active",
          addedAt: "2026-08-28T10:00:00.000Z",
        }],
      },
    });
    await store.createThread(ownerId, project.id, "Conversación visible");
    const session: AuthSession = {
      provider: "local",
      user: { id: memberId, name: "Member", email: "member@example.com" },
      tenant: { id: "shared-qa", name: "Shared QA" },
      expiresAt: "2026-08-29T00:00:00.000Z",
    };
    const snapshot = await loadSharedWorkbench(session);
    expect(snapshot.projects.some((item) => item.id === project.id)).toBe(true);
    expect(snapshot.threads.some((item) => item.projectId === project.id)).toBe(true);
    await expect(resolveProjectAccess({ ...session, user: { ...session.user, email: "other@example.com" } }, project.id))
      .rejects.toThrow("Projecte no trobat");
  });
});
