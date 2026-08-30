import { describe, expect, it } from "vitest";
import {
  publicActivityText,
  publicAssistantText,
  publicCommandTitle,
  publicProjectPath,
  publicToolOutput,
} from "@/ui/public-activity";

const internalPath = "/var/lib/aibrain/data/users/fc71a2c4-0db0-4914-af82-9564038ea964/runtime/codex-home/skills/web/SKILL.md";

describe("employee-facing activity sanitization", () => {
  it("removes literal Markdown, internal brands, host paths, UUIDs and installation IDs", () => {
    const result = publicActivityText([
      "**Identifying access issue**",
      `Codex inspected ${internalPath}`,
      "Instalación: company-qa",
      "request fc71a2c4-0db0-4914-af82-9564038ea964",
    ].join("\n"));

    expect(result).toContain("Identifying access issue");
    expect(result).toContain("Arnall");
    expect(result).not.toMatch(/\*\*|Codex|AiBrain|\/var\/lib|company-qa|fc71a2c4/iu);
  });

  it("describes real command purposes without rendering the command", () => {
    const command = `/bin/sh -lc "sed -n '1,260p' ${internalPath}"`;
    expect(publicCommandTitle(command)).toBe("Consultando archivos del proyecto");
    expect(publicCommandTitle("npm run test:unit", true)).toBe("En curso: Ejecutando comprobaciones");
    expect(publicCommandTitle(command)).not.toContain("/bin/sh");
  });

  it("keeps useful output and relative project files while rejecting host paths", () => {
    expect(publicToolOutput(`12 pruebas superadas\n${internalPath}`)).toBe("12 pruebas superadas\narchivo interno");
    expect(publicProjectPath("src/components/turn-activity.tsx")).toBe("src/components/turn-activity.tsx");
    expect(publicProjectPath(internalPath)).toBeNull();
    expect(publicProjectPath("../other-user/private.txt")).toBeNull();
  });

  it("sanitizes final answers while preserving Markdown and authenticated artifact links", () => {
    const artifactUrl = "/api/projects/00000000-0000-4000-8000-000000000011/artifacts/00000000-0000-4000-8000-000000000012";
    const result = publicAssistantText(
      `## Resultado\n\nAiBrain Instalación: company-qa ${internalPath}\n\n[Abrir](${artifactUrl})`,
      "Arnall AI",
    );
    expect(result).toContain("## Resultado");
    expect(result).toContain("Arnall AI Arnall archivo interno");
    expect(result).toContain(`[Abrir](${artifactUrl})`);
    expect(result).not.toMatch(/AiBrain|company-qa|\/var\/lib/iu);
    expect(publicAssistantText("Hola ", "Arnall AI")).toBe("Hola ");
  });
});
