import { describe, expect, it, vi } from "vitest";
import { resolveServerComposerExperience } from "@/runtime/composer-experience";

vi.mock("server-only", () => ({}));

describe("server composer experiences", () => {
  it("maps product choices to private provider settings on the server", () => {
    expect(resolveServerComposerExperience("fast")).toEqual({ model: "gpt-5.6-terra", effort: "low" });
    expect(resolveServerComposerExperience("smart")).toEqual({ model: "gpt-5.6-sol", effort: "low" });
    expect(resolveServerComposerExperience("expert")).toEqual({ model: "gpt-5.6-sol", effort: "high" });
  });
});
