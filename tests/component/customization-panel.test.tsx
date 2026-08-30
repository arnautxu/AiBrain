// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomizationPanel } from "@/components/customization-panel";
import { ThemeProvider } from "@/components/theme-provider";
import { initialRuntimeStatus } from "@/lib/runtime-status";
import type { SettingsSnapshot } from "@/settings/contracts";

function settings(isAdmin: boolean): SettingsSnapshot { return { schemaVersion: 1, account: { userId: "user", displayName: "Arnau", email: "arnau@example.com", provider: "local", expiresAt: "2026-08-29T00:00:00.000Z" }, company: { installationId: "example", name: "Example", isAdmin }, apps: [], connectors: [{ id: "gmail", label: "Gmail", status: "requires_login", statusCode: "GMAIL_LOGIN_REQUIRED", statusDetail: "Conecta tu cuenta personal.", accountEmail: null, scopes: ["https://www.googleapis.com/auth/gmail.readonly"], connectUrl: "/api/connectors/gmail/oauth/start", disconnectUrl: null, connectionVersion: null }], memory: { enabled: true, confirmationRequired: true, scopes: ["private", "project", "company"], provenanceVisible: true, employeeRuntimeIsolated: true, sharedComputerHistory: false }, notifications: { backgroundTurns: true, approvals: true, failures: true, sound: false }, permissions: [], privacy: { conversationStorage: "company_private", providerTraining: "not_managed_here", employeeIsolation: true, memoryScope: "explicit_user_memory" }, browser: { profileScope: "private_per_employee", networkPolicy: "public_http_https_only", privateNetworkAllowed: false, mutationsRequireApproval: true, downloadsArePrivate: true } }; }
function usage(scope: "personal" | "company") { return { schemaVersion: 1, scope, generatedAt: "2026-08-29T00:00:00.000Z", userId: "user", installationId: "example", notices: [], sharedSubscription: null, internal: { turns: 2, completedTurns: 1, errorTurns: 1, stoppedTurns: 0, activeDays: 1, totalDurationMs: 95_000, averageDurationMs: 47_500, p95DurationMs: 90_000, averageFirstTextMs: null, p95FirstTextMs: null, turnsWithTokenData: 0, tokens: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } }, ...(scope === "company" ? { members: [] } : {}) }; }

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
    expect(screen.getByRole("button", { name: "Uso" })).toBeInTheDocument();
    for (const hidden of ["Herramientas", "Permisos", "Datos y privacidad", "Navegador y red", "Equipo", "Alta local", "Grupos y políticas", "Registro de auditoría"]) expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/usage/company", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Uso" }));
    expect(await screen.findByText("Minutos trabajados")).toBeInTheDocument();
    expect(screen.getByText("2 min")).toBeInTheDocument();
  });

  it("offers an administrator the separate administration surface without employee tabs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings") return new Response(JSON.stringify(settings(true)), { status: 200 });
      if (url === "/api/usage/me") return new Response(JSON.stringify(usage("personal")), { status: 200 });
      if (url === "/api/usage/company") return new Response(JSON.stringify(usage("company")), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ThemeProvider><CustomizationPanel productName="Arnall AI" open runtimeStatus={initialRuntimeStatus} onClose={vi.fn()} /></ThemeProvider>);
    await waitFor(() => expect(screen.getByRole("link", { name: "Administración" })).toHaveAttribute("href", "/admin"));
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
