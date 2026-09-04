// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function renderSidebar(running = false) {
  const onNewThread = vi.fn();
  const onSelectThread = vi.fn();
  const onOpenCommandPalette = vi.fn();
  const onOpenAutomations = vi.fn();
  const onOpenCustomization = vi.fn();
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
      threadActivityById={running ? { "thread-plan": { state: "running", unreadCount: 0 } } : {}}
      onCloseMobile={vi.fn()}
      onCloseDesktop={vi.fn()}
      onOpenDesktop={vi.fn()}
      onOpenCommandPalette={onOpenCommandPalette}
      onOpenAutomations={onOpenAutomations}
      onSelectProject={vi.fn()}
      onSelectThread={onSelectThread}
      onNewThread={onNewThread}
      onNewProject={vi.fn()}
      onProjectAction={vi.fn()}
      onThreadAction={vi.fn()}
      onOpenCustomization={onOpenCustomization}
    />,
  );

  return { onNewThread, onSelectThread, onOpenAutomations, onOpenCommandPalette, onOpenCustomization };
}

afterEach(cleanup);

describe("Sidebar", () => {
  it("keeps navigation and new chats enabled while the selected chat works", () => {
    const { onNewThread, onSelectThread } = renderSidebar(true);
    const otherChat = screen.getByRole("button", { name: "Roadmap" });
    const newChat = screen.getByRole("button", { name: "Nueva conversación en Operaciones" });
    expect(otherChat).toBeEnabled();
    expect(newChat).toBeEnabled();
    fireEvent.click(otherChat);
    fireEvent.click(newChat);
    expect(onSelectThread).toHaveBeenCalledWith("thread-roadmap");
    expect(onNewThread).toHaveBeenCalledWith("project-operations");
  });

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

    const account = screen.getByRole("button", { name: /Abrir menú de cuenta/ });
    fireEvent.click(account);
    fireEvent.click(screen.getByRole("menuitem", { name: "Ayuda" }));

    const menu = screen.getByRole("menu", { name: "Cuenta y preferencias" });
    expect(screen.getByRole("note")).toHaveTextContent("archivos o elegir conectores autorizados");
    expect(within(menu).queryByText("Tema rápido")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Acme")).not.toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "Cuenta y preferencias" })).not.toBeInTheDocument();
    fireEvent.click(account);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("keeps the brand informational and gives account menus complete keyboard navigation", async () => {
    const { onNewThread, onOpenCustomization } = renderSidebar();
    const brand = screen.getByTestId("sidebar-brand");
    fireEvent.click(brand);
    expect(onNewThread).not.toHaveBeenCalled();
    expect(brand.closest("button")).toBeNull();

    const accountButton = screen.getByRole("button", { name: /Abrir menú de cuenta/ });
    expect(accountButton).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(accountButton);
    const menu = screen.getByRole("menu", { name: "Cuenta y preferencias" });
    await waitFor(() => {
      expect(within(menu).getByRole("menuitem", { name: "Configuración" })).toHaveFocus();
    });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(within(menu).getByRole("menuitem", { name: "Ayuda" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(within(menu).getByRole("menuitem", { name: "Cerrar sesión" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    const settings = within(menu).getByRole("menuitem", { name: "Configuración" });
    expect(settings).toHaveFocus();
    fireEvent.click(settings);
    expect(onOpenCustomization).toHaveBeenCalledWith(accountButton);
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
    expect(screen.getByRole("button", { name: "Contraer Operaciones" })).toHaveClass("sidebar-project-disclosure");

    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación en Operaciones" }));
    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación independiente" }));
    expect(onNewThread).toHaveBeenNthCalledWith(1, "project-operations");
    expect(onNewThread).toHaveBeenNthCalledWith(2);
  });

  it("uses one left content guide without indenting projects or their chats", () => {
    renderSidebar();

    expect(screen.getByTestId("sidebar-brand")).toHaveClass("px-2");
    expect(screen.getByTestId("sidebar-chats-label")).toHaveClass("px-2");
    expect(screen.getByTestId("sidebar-projects-label")).toHaveClass("px-2");
    expect(within(screen.getByRole("navigation", { name: "Navegación principal" })).getByRole("button", { name: "Nueva conversación" })).toHaveClass("pl-2");
    for (const row of screen.getAllByTestId("sidebar-project-row")) {
      expect(row).toHaveClass("pl-2");
      expect(row).not.toHaveClass("pl-7");
    }
    for (const row of screen.getAllByTestId("sidebar-project-thread")) {
      expect(row).toHaveClass("px-2");
      expect(row.parentElement?.parentElement?.parentElement).not.toHaveClass("ml-5");
    }
  });

  it("shows only one contextual action trigger and manages menu focus", () => {
    renderSidebar();
    const sidebar = screen.getByTestId("workbench-sidebar");
    const trigger = screen.getByRole("button", { name: "Acciones de Recordatorio personal" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    trigger.focus();
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: "Acciones de Recordatorio personal" });
    expect(sidebar).toHaveAttribute("data-context-menu-open", "true");
    expect(within(menu).getByRole("menuitem", { name: "Renombrar" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(within(menu).getByRole("menuitem", { name: "Fijar" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(within(menu).getByRole("menuitem", { name: "Archivar" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(within(menu).getByRole("menuitem", { name: "Renombrar" })).toHaveFocus();
    expect(trigger).not.toHaveClass("context-menu-suppressed");
    for (const other of screen.getAllByRole("button", { name: /Acciones de/ }).filter((button) => button !== trigger)) {
      expect(other).toHaveClass("context-menu-suppressed");
    }

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Acciones de Recordatorio personal" })).not.toBeInTheDocument();
    expect(sidebar).toHaveAttribute("data-context-menu-open", "false");
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    const reopenedMenu = screen.getByRole("menu", { name: "Acciones de Recordatorio personal" });
    const outside = render(<button type="button">Fora del menú</button>).getByRole("button", { name: "Fora del menú" });
    fireEvent.pointerDown(outside);
    outside.focus();
    expect(reopenedMenu).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it("closes a menu on Tab without leaving menu items in the tab order", async () => {
    renderSidebar();
    const accountButton = screen.getByRole("button", { name: /Abrir menú de cuenta/ });
    fireEvent.click(accountButton);
    const menu = screen.getByRole("menu", { name: "Cuenta y preferencias" });
    const settings = within(menu).getByRole("menuitem", { name: "Configuración" });
    await waitFor(() => expect(settings).toHaveFocus());
    expect(settings).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(menu, { key: "Tab" });
    await waitFor(() => expect(menu).not.toBeInTheDocument());
    await waitFor(() => expect(accountButton).toHaveFocus());
  });
});
