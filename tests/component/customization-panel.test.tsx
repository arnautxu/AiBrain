// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomizationPanel } from "@/components/customization-panel";
import { ThemeProvider } from "@/components/theme-provider";
import { initialRuntimeStatus } from "@/lib/runtime-status";
import type { SettingsSnapshot } from "@/settings/contracts";
import type { WorkbenchProject, WorkbenchThread } from "@/workbench/types";

function settings(isAdmin: boolean): SettingsSnapshot { return { schemaVersion: 1, account: { userId: "user", displayName: "Arnau", email: "arnau@example.com", provider: "local", expiresAt: "2026-08-29T00:00:00.000Z" }, company: { installationId: "example", name: "Example", isAdmin }, apps: [], connectors: [{ id: "gmail", label: "Gmail", status: "requires_login", statusCode: "GMAIL_LOGIN_REQUIRED", statusDetail: "Conecta tu cuenta personal.", accountEmail: null, scopes: ["https://www.googleapis.com/auth/gmail.readonly"], connectUrl: "/api/connectors/gmail/oauth/start", disconnectUrl: null, connectionVersion: null }, { id: "outlook", label: "Outlook", status: "requires_login", statusCode: "OUTLOOK_LOGIN_REQUIRED", statusDetail: "Conecta tu cuenta personal.", accountEmail: null, scopes: ["User.Read", "Mail.Read"], connectUrl: "/api/connectors/outlook/oauth/start", disconnectUrl: null, connectionVersion: null }], memory: { enabled: true, confirmationRequired: false, scopes: ["private", "project", "company"], provenanceVisible: true, employeeRuntimeIsolated: true, sharedComputerHistory: false }, notifications: { backgroundTurns: true, approvals: true, failures: true, sound: false }, permissions: [], privacy: { conversationStorage: "company_private", providerTraining: "not_managed_here", employeeIsolation: true, memoryScope: "automatic_private_memory" }, browser: { profileScope: "private_per_employee", networkPolicy: "public_http_https_only", privateNetworkAllowed: false, mutationsRequireApproval: true, downloadsArePrivate: true } }; }
function usage(scope: "personal" | "company") { return { schemaVersion: 1, scope, generatedAt: "2026-08-29T00:00:00.000Z", userId: "user", installationId: "example", notices: [], sharedSubscription: null, internal: { turns: 2, completedTurns: 1, errorTurns: 1, stoppedTurns: 0, activeDays: 1, totalDurationMs: 95_000, averageDurationMs: 47_500, p95DurationMs: 90_000, averageFirstTextMs: null, p95FirstTextMs: null, turnsWithTokenData: 0, tokens: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } }, ...(scope === "company" ? { members: [] } : {}) }; }
const archivedProject: WorkbenchProject = { id: "project-archived", name: "Fiscal 2025", slug: "fiscal-2025", status: "archived", pinned: false, instructions: "", sources: [], memory: { enabled: true, notes: "", updatedAt: null }, sharing: { visibility: "private", members: [] }, workspace: { id: "workspace-archived", label: "Fiscal 2025", hostType: "managed", status: "ready", isPrimary: true }, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" };
const archivedThread: WorkbenchThread = { id: "thread-archived", projectId: "project-active", title: "Cierre de julio", status: "archived", pinned: false, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", messages: [] };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) }); });

describe("CustomizationPanel", () => {
  it("keeps employee settings to theme, notifications and personal usage", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings") return new Response(JSON.stringify(settings(false)), { status: 200 });
      if (url === "/api/usage/me") return new Response(JSON.stringify(usage("personal")), { status: 200 });
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ThemeProvider><CustomizationPanel productName="Arnall AI" open runtimeStatus={initialRuntimeStatus} onClose={vi.fn()} /></ThemeProvider>);
    expect(await screen.findByRole("button", { name: "Apariencia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Avisos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectores" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Memoria" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archivados" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uso" })).toBeInTheDocument();
    for (const hidden of ["Herramientas", "Permisos", "Datos y privacidad", "Navegador y red", "Equipo", "Alta local", "Grupos y políticas", "Registro de auditoría"]) expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/usage/company", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Conectores" }));
    expect(screen.getByRole("link", { name: "Conectar Gmail" })).toHaveAttribute("href", "/api/connectors/gmail/oauth/start");
    expect(screen.getByRole("link", { name: "Conectar Outlook" })).toHaveAttribute("href", "/api/connectors/outlook/oauth/start");
    fireEvent.click(screen.getByRole("button", { name: "Uso" }));
    expect(await screen.findByText("Minutos trabajados")).toBeInTheDocument();
    expect(screen.getByText("2 min")).toBeInTheDocument();
  });

  it("keeps archived projects and conversations in settings and restores them explicitly", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings") return new Response(JSON.stringify(settings(false)), { status: 200 });
      if (url === "/api/usage/me") return new Response(JSON.stringify(usage("personal")), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    const onRestoreProject = vi.fn();
    const onRestoreThread = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ThemeProvider><CustomizationPanel productName="Arnall AI" open runtimeStatus={initialRuntimeStatus} projects={[archivedProject]} threads={[archivedThread]} onRestoreProject={onRestoreProject} onRestoreThread={onRestoreThread} onClose={vi.fn()} /></ThemeProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Archivados" }));
    expect(screen.getByText("Fiscal 2025")).toBeInTheDocument();
    expect(screen.getByText("Cierre de julio")).toBeInTheDocument();
    const restoreButtons = screen.getAllByRole("button", { name: "Restaurar" });
    fireEvent.click(restoreButtons[0]);
    fireEvent.click(restoreButtons[1]);
    expect(onRestoreProject).toHaveBeenCalledWith(archivedProject);
    expect(onRestoreThread).toHaveBeenCalledWith(archivedThread);
  });

  it("shows the memory list and controls directly inside settings", async () => {
    const projectId = "00000000-0000-4000-8000-000000000011";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings") return new Response(JSON.stringify(settings(false)), { status: 200 });
      if (url === "/api/usage/me") return new Response(JSON.stringify(usage("personal")), { status: 200 });
      if (url === "/api/memory?status=all&limit=100") return new Response(JSON.stringify({ memories: [] }), { status: 200 });
      if (url === `/api/memory/proposals?projectId=${projectId}`) return new Response(JSON.stringify({ proposals: [], memories: [{ schemaVersion: 1, memoryId: "00000000-0000-4000-8000-000000000099", proposalId: "00000000-0000-4000-8000-000000000098", installationId: "example", ownerUserId: "user", projectId: null, scope: "private", kind: "recollection", content: "Prefiero informes en PDF.", provenance: { sourceType: "background-conversation", threadId: "thread-1", turnId: "turn-1", callId: "automatic:recollection-informes:turn-1", toolNames: [], sourceExcerpt: "Prefiero informes en PDF.", capturedAt: "2026-08-30T10:00:00.000Z" }, status: "active", revision: 1, createdAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:00:00.000Z", deletedAt: null, deletedBy: null }], allowCompanyScope: false }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ThemeProvider><CustomizationPanel productName="Arnall AI" open activeProjectId={projectId} runtimeStatus={initialRuntimeStatus} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Memoria" }));
    expect(await screen.findByText("Prefiero informes en PDF.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gestionar memoria" })).not.toBeInTheDocument();
  });

  it("keeps administrator and policy shortcuts out of employee settings", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings") return new Response(JSON.stringify(settings(true)), { status: 200 });
      if (url === "/api/usage/me") return new Response(JSON.stringify(usage("personal")), { status: 200 });
      if (url === "/api/usage/company") return new Response(JSON.stringify(usage("company")), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ThemeProvider><CustomizationPanel productName="Arnall AI" open runtimeStatus={initialRuntimeStatus} onClose={vi.fn()} /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText("Claro u oscuro")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Administración" })).not.toBeInTheDocument();
    expect(screen.queryByText(/políticas de empresa/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Equipo" })).not.toBeInTheDocument();
    expect(screen.queryByText("Alta local")).not.toBeInTheDocument();
  });

  it("retries loading settings after a recoverable error", async () => {
    let settingsRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings") {
        settingsRequests += 1;
        return settingsRequests === 1
          ? new Response("{}", { status: 503 })
          : new Response(JSON.stringify(settings(false)), { status: 200 });
      }
      if (url === "/api/usage/me") return new Response(JSON.stringify(usage("personal")), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ThemeProvider><CustomizationPanel productName="Arnall AI" open runtimeStatus={initialRuntimeStatus} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(settingsRequests).toBe(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Avisos" })).toBeInTheDocument();
  });
});
