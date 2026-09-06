import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isThemePreference, resolveTheme } from "@/ui/theme";

describe("theme contract", () => {
  it("uses matte graphite and softer reading text in both dark preferences", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("--mineral-black: #181816;");
    expect(css.match(/--text: #f5f5f2;/g)).toHaveLength(2);
    expect(css.match(/--user-message-text: var\(--text\);/g)).toHaveLength(2);
    expect(css.match(/--send-button: var\(--mineral-white\);/g)).toHaveLength(2);
  });

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
