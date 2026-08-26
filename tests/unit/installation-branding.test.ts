import { describe, expect, it } from "vitest";
import { resolveUiInstallationBranding } from "@/ui/installation-branding";

describe("UI installation branding", () => {
  it("uses the development installation as a safe fallback", () => {
    expect(resolveUiInstallationBranding("unknown")).toMatchObject({
      installationId: "example-lab-dev",
      productName: "Example Brain",
      accentColor: "#315ee7",
    });
  });

  it("changes company, domain, assets and accent without component forks", () => {
    expect(resolveUiInstallationBranding("northwind-qa")).toEqual({
      installationId: "northwind-qa",
      companyName: "Northwind Advisory QA",
      companySlug: "northwind-advisory",
      publicUrl: "https://brain.northwind-advisory.test",
      productName: "Northwind Brain",
      logoPath: "/branding/northwind-qa/logo.svg",
      faviconPath: "/branding/northwind-qa/favicon.svg",
      accentColor: "#0f766e",
    });
  });
});
