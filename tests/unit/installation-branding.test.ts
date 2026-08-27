import { describe, expect, it } from "vitest";
import { baseBrainManifest, customAccentTokens } from "@/config/brain";
import { applyInstallationBranding, publicInstallationBranding } from "@/config/installation-branding";
import { parseInstallationConfig } from "@/config/installation-schema";

function installation(accentColor: string) {
  return parseInstallationConfig({
    schemaVersion: 1,
    installationId: "branding-qa",
    companyName: "Branding QA",
    companySlug: "branding-qa",
    publicUrl: "https://brain.branding.test",
    branding: {
      productName: "Configured Brain",
      logoPath: "/branding/qa/logo.svg",
      faviconPath: "/branding/qa/favicon.svg",
      accentColor,
    },
    paths: {
      dataRoot: "/srv/branding-qa/data",
      companyContextRoot: "/srv/branding-qa/data/company",
      usersRoot: "/srv/branding-qa/data/users",
      sourceReadRoot: "/srv/branding-qa/source-ro",
      publishWriteRoot: "/srv/branding-qa/publish-rw",
      backupsRoot: "/srv/branding-qa/data/backups",
    },
  });
}

describe("installation branding", () => {
  it("applies product and exact accent without mutating the shared manifest", () => {
    const config = installation("#0f766e");
    const branded = applyInstallationBranding(baseBrainManifest, config);
    expect(branded.identity.productName).toBe("Configured Brain");
    expect(branded.interface.accentColor).toBe("#0f766e");
    expect(baseBrainManifest.interface.accentColor).toBeUndefined();
    expect(publicInstallationBranding(config)).toMatchObject({
      installationId: "branding-qa",
      productName: "Configured Brain",
      accentColor: "#0f766e",
    });
  });

  it("chooses readable contrast for dark and light configured colors", () => {
    expect(customAccentTokens("#0f766e")).toMatchObject({ solid: "#0f766e", contrast: "#ffffff" });
    expect(customAccentTokens("#ffffff")).toMatchObject({ solid: "#ffffff", contrast: "#111827" });
    expect(customAccentTokens("not-a-color")).toBeNull();
  });
});
