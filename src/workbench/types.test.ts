import { describe, expect, it } from "vitest";
import { isWorkbenchProject, type WorkbenchProject } from "@/workbench/types";

const project: WorkbenchProject = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Operaciones",
  slug: "operaciones",
  status: "active",
  pinned: false,
  instructions: "",
  sources: [],
  memory: { enabled: true, notes: "", updatedAt: null },
  sharing: { visibility: "private", members: [] },
  workspace: {
    id: "00000000-0000-4000-8000-000000000002",
    label: "Operaciones",
    hostType: "managed",
    status: "ready",
    isPrimary: true,
  },
  createdAt: "2026-08-30T08:00:00.000Z",
  updatedAt: "2026-08-30T08:00:00.000Z",
};

describe("workbench project access projection", () => {
  it("accepts legacy projects and coherent server-issued capability sets", () => {
    expect(isWorkbenchProject(project)).toBe(true);
    expect(isWorkbenchProject({
      ...project,
      access: { role: "viewer", canEdit: false, canManage: false },
    })).toBe(true);
    expect(isWorkbenchProject({
      ...project,
      access: { role: "editor", canEdit: true, canManage: false },
    })).toBe(true);
  });

  it("rejects contradictory or expanded capability projections", () => {
    expect(isWorkbenchProject({
      ...project,
      access: { role: "viewer", canEdit: true, canManage: false },
    })).toBe(false);
    expect(isWorkbenchProject({
      ...project,
      access: { role: "owner", canEdit: true, canManage: true, foreign: true },
    })).toBe(false);
  });
});
