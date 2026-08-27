import "server-only";

import type { ProjectSource, WorkbenchProject, WorkbenchThread } from "@/workbench/types";

export type StoredProject = WorkbenchProject & {
  workspaceKey: string;
};

export type StoredThread = WorkbenchThread & {
  runtimeThreadToken: string | null;
};

export type ThreadRuntimeContext = {
  projectId: string;
  projectName: string;
  workspaceKey: string;
  projectInstructions: string;
  projectMemory: string;
  projectSources: Pick<ProjectSource, "kind" | "name" | "url" | "excerpt" | "status">[];
  runtimeThreadToken: string | null;
};

export function publicProject(project: StoredProject): WorkbenchProject {
  const { workspaceKey: _workspaceKey, ...visible } = project;
  return visible;
}

export function publicThread(thread: StoredThread): WorkbenchThread {
  const { runtimeThreadToken: _runtimeThreadToken, ...visible } = thread;
  return visible;
}

export function slugifyName(name: string) {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 55);
  return normalized || "projecte";
}

export function uniqueSlug(name: string, used: Set<string>) {
  const base = slugifyName(name);
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, 58 - String(suffix).length)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("No s’ha pogut generar un slug únic per al projecte.");
}
