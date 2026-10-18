import { afterEach, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ locale: "en" as "en" | "es" }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/auth/session", () => ({ getSession: async () => ({ provider: "local", tenant: { id: "retaildemo" } }) }));
vi.mock("@/config/installation", () => ({ loadInstallationConfig: async () => ({
  installationId: "retaildemo", companyName: "RETAILDEMO", companySlug: "retaildemo", publicUrl: "https://example.invalid",
  branding: { productName: "RETAILDEMO AI", accentColor: "#123456", logoPath: "/logo.png", faviconPath: "/logo.png" },
}) }));
vi.mock("@/workbench/store", () => ({ loadWorkbench: async () => ({}) }));
vi.mock("@/i18n/server", () => ({ installationUiLocale: async () => fixtures.locale }));
vi.mock("@/components/brain-app", () => ({ BrainApp: () => null }));

import Home from "@/app/page";

afterEach(() => { fixtures.locale = "en"; });

it.each(["en", "es"] as const)("starts chat turns in the company's %s language instead of the Spanish seed default", async locale => {
  fixtures.locale = locale;
  const page = await Home({ searchParams: Promise.resolve({}) });
  expect(page.props.manifest.identity.language).toBe(locale);
  expect(page.props.manifest.identity.assistantName).toBe("RETAILDEMO AI");
});
