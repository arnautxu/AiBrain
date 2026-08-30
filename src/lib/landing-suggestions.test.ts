import { describe, expect, it } from "vitest";
import { landingSuggestions } from "@/lib/landing-suggestions";

describe("landing suggestions", () => {
  it("uses project and installation context only", () => {
    const suggestions = landingSuggestions({ id: "project-1", name: "Operaciones", slug: "operaciones", status: "active", pinned: false, instructions: "", sources: [], memory: { enabled: true, notes: "", updatedAt: null }, sharing: { visibility: "private", members: [] }, workspace: { id: "main", label: "Principal", hostType: "managed", status: "ready", isPrimary: true }, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" }, "Arnall");
    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.prompt).join(" ")).toContain("Operaciones");
    expect(suggestions.map((suggestion) => suggestion.prompt).join(" ")).not.toMatch(/correo|email/i);
  });

  it("offers Gmail only when the connector is authorized", () => {
    const withoutGmail = landingSuggestions(null, "Arnall");
    const withGmail = landingSuggestions(null, "Arnall", { gmailAuthorized: true });

    expect(withoutGmail.map((suggestion) => suggestion.label).join(" ")).not.toMatch(/Gmail/i);
    expect(withGmail.map((suggestion) => suggestion.label).join(" ")).toMatch(/Gmail/i);
    expect(withGmail).toHaveLength(3);
  });
});
