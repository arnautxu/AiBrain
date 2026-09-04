// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTOMATION_EXECUTION_CONTEXT, type AutomationTaskView } from "@/automations/contracts";
import { AutomationsPanel } from "@/components/automations-panel";
import type { WorkbenchProject } from "@/workbench/types";

const ownerId = "00000000-0000-4000-8000-000000000001";
const memberId = "00000000-0000-4000-8000-000000000002";
const groupId = "00000000-0000-4000-8000-000000000010";
const projectId = "10000000-0000-4000-8000-000000000001";

const project: WorkbenchProject = {
  id: projectId,
  name: "Operaciones",
  slug: "operaciones",
  status: "active",
  pinned: false,
  instructions: "",
  sources: [],
  memory: { enabled: true, notes: "", updatedAt: null },
  sharing: { visibility: "private", members: [] },
  workspace: { id: "operations-workspace", label: "Operaciones", hostType: "managed", status: "ready", isPrimary: true },
  createdAt: "2026-08-30T08:00:00.000Z",
  updatedAt: "2026-08-30T08:00:00.000Z",
};

const viewerTask: AutomationTaskView = {
  schemaVersion: 1,
  id: "20000000-0000-4000-8000-000000000001",
  installationId: "audience-qa",
  userId: ownerId,
  audience: { membershipPolicy: "current", userIds: [], groupIds: [groupId] },
  name: "Informe compartido",
  prompt: "Prepara el informe.",
  projectId,
  projectName: project.name,
  timeZone: "Europe/Madrid",
  schedule: { kind: "daily", hour: 9, minute: 0 },
  executionContext: DEFAULT_AUTOMATION_EXECUTION_CONTEXT,
  state: "active",
  nextRunAt: "2030-08-30T07:00:00.000Z",
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
  retryAt: null,
  manualRun: null,
  deletedAt: null,
  cancellationRequestedAt: null,
  lease: null,
  createdAt: "2026-08-30T08:00:00.000Z",
  updatedAt: "2026-08-30T08:00:00.000Z",
  access: { canManage: false, canViewResults: true },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AutomationsPanel audience", () => {
  it("keeps the mobile sidebar control available on the automations surface", () => {
    const onToggleSidebar = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    render(<AutomationsPanel open projects={[project]} onToggleSidebar={onToggleSidebar} />);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }));

    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it("shows only authorized controls and defaults a new task to the current user with optional users and groups", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return new Response(JSON.stringify({
          tasks: [viewerTask],
          worker: null,
          audienceDirectory: {
            membershipPolicy: "current",
            currentUserId: ownerId,
            users: [{ id: ownerId, name: "Owner" }, { id: memberId, name: "Member" }],
            groups: [{ id: groupId, name: "Operaciones" }],
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body));
      requests.push({ method, body });
      return new Response(JSON.stringify({ task: { ...viewerTask, ...body, access: { canManage: true, canViewResults: true } } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }));

    render(<AutomationsPanel open projects={[project]} />);
    expect(screen.getByRole("main", { name: "Automatizaciones" })).toBeInTheDocument();
    expect(screen.queryByText("Centro de tareas")).not.toBeInTheDocument();
    expect(screen.queryByText(/Servicio de automatizaciones|Se ejecutan mientras/i)).not.toBeInTheDocument();
    expect(await screen.findByText("Destinatarios: Grupo: Operaciones")).toBeInTheDocument();
    expect(screen.queryByText("Centro de tareas")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar Informe compartido" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nueva" }));
    const owner = screen.getByRole("checkbox", { name: "Owner" });
    const member = screen.getByRole("checkbox", { name: "Member" });
    const group = screen.getByRole("checkbox", { name: "Operaciones" });
    expect(owner).toBeChecked();
    expect(member).not.toBeChecked();
    fireEvent.click(member);
    fireEvent.click(group);
    fireEvent.change(screen.getByPlaceholderText("Resumen diario del proyecto"), { target: { value: "Informe nuevo" } });
    fireEvent.change(screen.getByPlaceholderText("Revisa las novedades del proyecto y prepara un resumen con próximos pasos."), { target: { value: "Prepara el informe nuevo." } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      method: "POST",
      body: {
        audience: { membershipPolicy: "current", userIds: [ownerId, memberId], groupIds: [groupId] },
      },
    });
  });

  it("keeps the empty action centered and labels the standalone project as Sin proyecto", async () => {
    const standaloneProject = { ...project, name: "Conversaciones", slug: "aibrain-standalone-chats" };
    const standaloneTask = { ...viewerTask, projectId: standaloneProject.id, projectName: "Conversaciones" };
    let tasks: AutomationTaskView[] = [standaloneTask];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      tasks,
      worker: null,
      audienceDirectory: {
        membershipPolicy: "current",
        currentUserId: ownerId,
        users: [{ id: ownerId, name: "Owner" }],
        groups: [{ id: groupId, name: "Operaciones" }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const view = render(<AutomationsPanel open projects={[standaloneProject]} />);
    expect(await screen.findByText(/Sin proyecto ·/)).toBeInTheDocument();
    view.unmount();

    tasks = [];
    render(<AutomationsPanel open projects={[standaloneProject]} />);
    const emptyAction = await screen.findByRole("button", { name: "Nueva" });
    expect(emptyAction).toHaveClass("mx-auto");
    expect(emptyAction.parentElement).toHaveClass("workspace-empty-state");
  });

  it("persists an edited one-time date and minute instead of the form default", async () => {
    const onceTask: AutomationTaskView = {
      ...viewerTask,
      access: { canManage: true, canViewResults: true },
      audience: { membershipPolicy: "current", userIds: [ownerId], groupIds: [] },
      schedule: { kind: "once", runAt: "2030-08-29T23:28:00.000Z" },
    };
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return new Response(JSON.stringify({
          tasks: [onceTask],
          audienceDirectory: {
            membershipPolicy: "current",
            currentUserId: ownerId,
            users: [{ id: ownerId, name: "Owner" }],
            groups: [],
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ method, body });
      return new Response(JSON.stringify({ task: { ...onceTask, ...body } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    render(<AutomationsPanel open projects={[project]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar Informe compartido" }));
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2030-08-30" } });
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "00:31" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      method: "PATCH",
      body: {
        schedule: { kind: "once", runAt: "2030-08-29T22:31:00.000Z" },
        timeZone: "Europe/Madrid",
      },
    });
  });

  it("opens the editor as a named focus-trapped dialog and restores its opener on Escape", async () => {
    const managedTask = { ...viewerTask, access: { canManage: true, canViewResults: true } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      tasks: [managedTask],
      audienceDirectory: {
        membershipPolicy: "current",
        currentUserId: ownerId,
        users: [{ id: ownerId, name: "Owner" }],
        groups: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<AutomationsPanel open projects={[project]} />);
    const opener = await screen.findByRole("button", { name: "Editar Informe compartido" });
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Editar automatización" });
    const name = screen.getByRole("textbox", { name: "Nombre" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(name).toHaveFocus());

    const cancel = screen.getByRole("button", { name: "Cancelar" });
    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("combobox", { name: "Zona horaria" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar automatización" })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("keeps a dirty draft on Escape until the user explicitly discards it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      tasks: [],
      audienceDirectory: {
        membershipPolicy: "current",
        currentUserId: ownerId,
        users: [{ id: ownerId, name: "Owner" }],
        groups: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<AutomationsPanel open projects={[project]} />);
    const opener = await screen.findByRole("button", { name: "Nueva" });
    fireEvent.click(opener);
    const name = screen.getByRole("textbox", { name: "Nombre" });
    await waitFor(() => expect(name).toHaveFocus());
    fireEvent.change(name, { target: { value: "Borrador importante" } });
    fireEvent.keyDown(document, { key: "Escape" });

    const confirmation = await screen.findByRole("alertdialog", { name: "¿Descartar los cambios?" });
    expect(confirmation).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Nueva automatización" })).toBeInTheDocument();
    const continueEditing = screen.getByRole("button", { name: "Seguir editando" });
    const discard = screen.getByRole("button", { name: "Descartar cambios" });
    await waitFor(() => expect(continueEditing).toHaveFocus());
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(discard).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(continueEditing).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog", { name: "¿Descartar los cambios?" })).not.toBeInTheDocument();
    await waitFor(() => expect(name).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "Descartar cambios" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nueva automatización" })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("uses a focus-managed confirmation dialog before deleting an automation", async () => {
    const managedTask = { ...viewerTask, access: { canManage: true, canViewResults: true } };
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "DELETE") {
        requests.push(url);
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({
        tasks: [managedTask],
        audienceDirectory: {
          membershipPolicy: "current",
          currentUserId: ownerId,
          users: [{ id: ownerId, name: "Owner" }],
          groups: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    render(<AutomationsPanel open projects={[project]} />);
    const opener = await screen.findByRole("button", { name: "Eliminar Informe compartido" });
    fireEvent.click(opener);

    expect(screen.getByRole("alertdialog", { name: "¿Eliminar “Informe compartido”?" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus());
    expect(requests).toEqual([]);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "¿Eliminar “Informe compartido”?" })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar automatización" }));
    await waitFor(() => expect(requests).toEqual([`/api/automations/${viewerTask.id}`]));
    expect(screen.queryByText("Informe compartido")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Nueva" })).toHaveFocus());
  });

  it("reports editor and deletion surfaces so the app can prevent stacked global dialogs", async () => {
    const managedTask = { ...viewerTask, access: { canManage: true, canViewResults: true } };
    const onBlockingSurfaceChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      tasks: [managedTask],
      audienceDirectory: {
        membershipPolicy: "current",
        currentUserId: ownerId,
        users: [{ id: ownerId, name: "Owner" }],
        groups: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(
      <AutomationsPanel
        open
        projects={[project]}
        onBlockingSurfaceChange={onBlockingSurfaceChange}
      />,
    );
    await screen.findByRole("button", { name: "Editar Informe compartido" });
    await waitFor(() => expect(onBlockingSurfaceChange).toHaveBeenLastCalledWith(false));
    onBlockingSurfaceChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Nueva" }));
    expect(onBlockingSurfaceChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre" }), { target: { value: "Borrador" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByRole("alertdialog", { name: "¿Descartar los cambios?" })).toBeInTheDocument();
    expect(onBlockingSurfaceChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    await waitFor(() => expect(onBlockingSurfaceChange).toHaveBeenLastCalledWith(false));

    onBlockingSurfaceChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Informe compartido" }));
    expect(onBlockingSurfaceChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onBlockingSurfaceChange).toHaveBeenLastCalledWith(false));
  });
});
