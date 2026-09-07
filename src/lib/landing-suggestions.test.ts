import { describe, expect, it } from "vitest";
import { landingSuggestions, scheduledPromptTemplates } from "@/lib/landing-suggestions";

describe("landing prompt templates", () => {
  it("uses the same fixed tasks regardless of connector availability", () => {
    expect(landingSuggestions(null, "Arnall", { gmailAuthorized: true })).toEqual(scheduledPromptTemplates("Arnall"));
    expect(landingSuggestions(null, "Arnall")).toEqual(scheduledPromptTemplates("Arnall"));
    expect(scheduledPromptTemplates("Arnall")[2].children).toHaveLength(3);
  });
  it("preserves the installation name and image generation suggestions", () => {
    expect(scheduledPromptTemplates("Example")[2].label).toContain("Example");
    expect(scheduledPromptTemplates("Example")[2].children?.every(item => item.prompt.includes("Example"))).toBe(true);
    expect(landingSuggestions(null, "Arnall", { imageGeneration: true })[0].id).toBe("presentation-image");
  });
});
