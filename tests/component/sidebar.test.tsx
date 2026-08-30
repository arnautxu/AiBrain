// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/sidebar";
import type { AuthSession } from "@/auth/types";
import type { PublicInstallationBranding } from "@/config/installation-branding";
import type { WorkbenchProject, WorkbenchThread } from "@/workbench/types";
import { STANDALONE_PROJECT_SLUG } from "@/workbench/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ui/primitives", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/primitives")>();
  return { ...original, ThemeToggle: () => <button type="button">Cambiar tema</button> };
});

const branding: PublicInstallationBranding = {
  installationId: "acme",
  companyName: "Acme",
  companySlug: "acme",
  publicUrl: "https://acme.example.com",
  productName: "AiBrain",
  logoPath: "/logo.svg",
  faviconPath: "/favicon.svg",
  accentColor: "#000000",
};

const session: AuthSession = {
  provider: "local",
  user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
  tenant: { id: "tenant-1", name: "Acme" },
  expiresAt: "2026-08-29T00:00:00.000Z",
};

function project(id: string, name: string, slug = name.toLocaleLowerCase()): WorkbenchProject {
  return {
    id,
    name,
    slug,
    status: "active",
    pinned: false,
    instructions: "",
    sources: [],
    memory: { enabled: true, notes: "", updatedAt: null },
    sharing: { visibility: "private", members: [] },
    workspace: { id: `workspace-${id}`, label: name, hostType: "managed", status: "ready", isPrimary: true },
    createdAt: "2026-08-28T08:00:00.000Z",
    updatedAt: "2026-08-28T08:00:00.000Z",
  };
}

function thread(id: string, projectId: string, title: string): WorkbenchThread {
  return {
    id,
    projectId,
    title,
    status: "active",
    pinned: false,
    createdAt: "2026-08-28T08:00:00.000Z",
    updatedAt: "2026-08-28T08:00:00.000Z",
    messages: [],
  };
}

function renderSidebar() {
  const onNewThread = vi.fn();
  const onOpenCommandPalette = vi.fn();
  const onOpenAutomations = vi.fn();
  const operations = project("project-operations", "Operaciones");
  const product = project("project-product", "Producto");
  const standalone = project("project-standalone", "Chats", STANDALONE_PROJECT_SLUG);

  render(
    <Sidebar
      branding={branding}
      session={session}
      projects={[operations, product, standalone]}
      threads={[
        thread("thread-plan", operations.id, "Plan semanal"),
        thread("thread-roadmap", product.id, "Roadmap"),
        thread("thread-personal", standalone.id, "Recordatorio personal"),
      ]}
      activeProjectId={operations.id}
      activeThreadId="thread-plan"
      mobileOpen={false}
      desktopOpen
      busy={false}
      threadActivityById={{}}
      onCloseMobile={vi.fn()}
      onCloseDesktop={vi.fn()}
      onOpenDesktop={vi.fn()}
      onOpenCommandPalette={onOpenCommandPalette}
      onOpenAutomations={onOpenAutomations}
      onSelectProject={vi.fn()}
      onSelectThread={vi.fn()}
      onNewThread={onNewThread}
      onNewProject={vi.fn()}
      onProjectAction={vi.fn()}
      onThreadAction={vi.fn()}
      onOpenCustomization={vi.fn()}
    />,
  );

  return { onNewThread, onOpenAutomations, onOpenCommandPalette };
}

afterEach(cleanup);

describe("Sidebar", () => {
  it("keeps the primary navigation focused on conversations and automations", () => {
    const { onOpenAutomations, onOpenCommandPalette } = renderSidebar();
    const navigation = screen.getByRole("navigation", { name: "Navegación principal" });

    expect(within(navigation).getByRole("button", { name: /Nueva conversación/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(within(navigation).getByRole("button", { name: "Automatizaciones" }));
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
    expect(onOpenAutomations).toHaveBeenCalledOnce();
    expect(within(navigation).queryByText("Biblioteca")).not.toBeInTheDocument();
    expect(within(navigation).queryByText("Centro de tareas")).not.toBeInTheDocument();
    expect(within(navigation).queryByText("⌘K")).not.toBeInTheDocument();
    expect(within(navigation).queryByText("Buscar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir preferencias" })).not.toBeInTheDocument();
  });

  it("offers contextual help from the account menu", () => {
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: /Abrir menú de cuenta/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ayuda" }));

    const menu = screen.getByRole("menu", { name: "Cuenta y preferencias" });
    expect(screen.getByRole("note")).toHaveTextContent("archivos o elegir conectores autorizados");
    expect(within(menu).queryByText("Tema rápido")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Acme")).not.toBeInTheDocument();
  });

  it("nests every project chat below its project and keeps standalone chats separate", () => {
    const { onNewThread } = renderSidebar();
    const operationsChats = screen.getByLabelText("Chats de Operaciones");
    const productChats = screen.getByLabelText("Chats de Producto");
    const standaloneChats = screen.getByRole("region", { name: "Chats" });

    expect(within(operationsChats).getByRole("button", { name: "Plan semanal" })).toBeInTheDocument();
    expect(within(operationsChats).queryByText("Roadmap")).not.toBeInTheDocument();
    expect(within(productChats).getByRole("button", { name: "Roadmap" })).toBeInTheDocument();
    expect(within(standaloneChats).getByRole("button", { name: "Recordatorio personal" })).toBeInTheDocument();
    expect(within(standaloneChats).queryByText("Plan semanal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación en Operaciones" }));
    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación independiente" }));
    expect(onNewThread).toHaveBeenNthCalledWith(1, "project-operations");
    expect(onNewThread).toHaveBeenNthCalledWith(2);
  });
});
