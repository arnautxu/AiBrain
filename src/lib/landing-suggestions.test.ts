import { describe, expect, it } from "vitest";
import { landingSuggestions } from "@/lib/landing-suggestions";

describe("landing suggestions", () => {
  it("uses project and installation context only", () => {
    const suggestions = landingSuggestions({ id: "project-1", name: "Operaciones", slug: "operaciones", status: "active", pinned: false, instructions: "", sources: [], memory: { enabled: true, notes: "", updatedAt: null }, sharing: { visibility: "private", members: [] }, workspace: { id: "main", label: "Principal", hostType: "managed", status: "ready", isPrimary: true }, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" }, "Arnall");
    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.prompt).join(" ")).toContain("Operaciones");
    expect(suggestions.map((suggestion) => suggestion.prompt).join(" ")).not.toMatch(/correo|email/i);
  });
});
