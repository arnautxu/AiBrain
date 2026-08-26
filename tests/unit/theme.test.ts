import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme } from "@/ui/theme";

describe("theme contract", () => {
  it("resolves the system preference deterministically", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("rejects unknown persisted values", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
  });
});
