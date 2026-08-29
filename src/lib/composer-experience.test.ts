import { describe, expect, it } from "vitest";
import { COMPOSER_EXPERIENCES, isComposerExperience, resolveComposerExperience } from "@/lib/composer-experience";

describe("composer experiences", () => {
  it("maps the three employee-facing choices to the approved provider settings", () => {
    expect(COMPOSER_EXPERIENCES.fast).toMatchObject({ model: "gpt-5.6-terra", effort: "low" });
    expect(resolveComposerExperience("smart")).toMatchObject({ model: "gpt-5.6-sol", effort: "low" });
    expect(resolveComposerExperience("expert")).toMatchObject({ model: "gpt-5.6-sol", effort: "high" });
  });

  it("does not accept provider names as UI modes", () => {
    expect(isComposerExperience("smart")).toBe(true);
    expect(isComposerExperience("gpt-5.6-sol")).toBe(false);
  });
});
