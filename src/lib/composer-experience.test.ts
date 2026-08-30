import { describe, expect, it } from "vitest";
import { isComposerExperience } from "@/lib/composer-experience";

describe("composer experiences", () => {
  it("does not accept provider names as UI modes", () => {
    expect(isComposerExperience("smart")).toBe(true);
    expect(isComposerExperience("gpt-5.6-sol")).toBe(false);
  });
});
