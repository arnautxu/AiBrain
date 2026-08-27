// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomizationPanel } from "@/components/customization-panel";
import { defaultPreferences } from "@/config/brain";
import { initialRuntimeStatus } from "@/lib/runtime-status";
import type { SettingsSnapshot } from "@/settings/contracts";

const settings: SettingsSnapshot = {
  schemaVersion: 1,
  account: { userId: "user", displayName: "Ada", email: "ada@example.com", provider: "local", expiresAt: "2026-08-29T00:00:00.000Z" },
  company: { installationId: "example", name: "Example", isAdmin: true },
  apps: [{
    id: "web-search", label: "Búsqueda web", description: "Consulta fuentes públicas.", kind: "capability",
    status: "available", statusDetail: "Disponible para usar.", scopes: ["Internet público"], permissionActions: ["consult"],
    approvalRequired: false, installationEnabled: true, userEnabled: true, effectiveEnabled: true,
    canUserChange: true, canAdminChange: true, configurationHint: null,
  }],
  notifications: { backgroundTurns: true, approvals: true, failures: true, sound: false },
  permissions: [{ action: "consult", effect: "allow", rules: [] }],
  privacy: { conversationStorage: "company_private", providerTraining: "not_managed_here", employeeIsolation: true, memoryScope: "explicit_user_memory" },
  browser: { profileScope: "private_per_employee", networkPolicy: "public_http_https_only", privateNetworkAllowed: false, mutationsRequireApproval: true, downloadsArePrivate: true },
};

afterEach(() => vi.unstubAllGlobals());

describe("CustomizationPanel", () => {
  it("shows a truthful app catalogue and persists an employee gate", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/settings") {
        const response = init?.method === "PATCH"
          ? { ...settings, apps: [{ ...settings.apps[0]!, userEnabled: false, effectiveEnabled: false }] }
          : settings;
        return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 503, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CustomizationPanel
      productName="Example Brain"
      open
      preferences={defaultPreferences}
      runtimeStatus={{
        ...initialRuntimeStatus,
        codex: "connected",
        ready: true,
        capabilities: { ...initialRuntimeStatus.capabilities, webSearch: true },
      }}
      selectedSkill={null}
      onSelectedSkillChange={vi.fn()}
      onChange={vi.fn()}
      onReset={vi.fn()}
      onClose={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Apps y herramientas" }));
    expect(await screen.findByText("Búsqueda web")).toBeInTheDocument();
    expect(screen.getByText("Internet público")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activar Búsqueda web" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ method: "PATCH" })));
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ target: "user-app", appId: "web-search", enabled: false });
  });
});
