import {
  isWorkbenchProject,
  isWorkbenchThread,
  type UpdateProjectInput,
  type UpdateThreadInput,
  type WorkbenchProject,
  type WorkbenchThread,
} from "@/workbench/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function responseBody(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : "El workbench no ha pogut completar l’acció.";
    throw new Error(message);
  }
  return body;
}

export async function createProjectRequest(name: string): Promise<WorkbenchProject> {
  const body = await responseBody(await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }));
  if (!isRecord(body) || !isWorkbenchProject(body.project)) {
    throw new Error("El servidor ha retornat un projecte no vàlid.");
  }
  return body.project;
}

export async function updateProjectRequest(
  projectId: string,
  patch: UpdateProjectInput,
): Promise<WorkbenchProject> {
  const body = await responseBody(await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
  if (!isRecord(body) || !isWorkbenchProject(body.project)) {
    throw new Error("El servidor ha retornat un projecte no vàlid.");
  }
  return body.project;
}

export async function createThreadRequest(
  projectId: string,
  title: string,
): Promise<WorkbenchThread> {
  const body = await responseBody(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  ));
  if (!isRecord(body) || !isWorkbenchThread(body.thread)) {
    throw new Error("El servidor ha retornat un fil no vàlid.");
  }
  return body.thread;
}

export async function updateThreadRequest(
  threadId: string,
  patch: UpdateThreadInput,
): Promise<WorkbenchThread> {
  const body = await responseBody(await fetch(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
  if (!isRecord(body) || !isWorkbenchThread(body.thread)) {
    throw new Error("El servidor ha retornat un fil no vàlid.");
  }
  return body.thread;
}
