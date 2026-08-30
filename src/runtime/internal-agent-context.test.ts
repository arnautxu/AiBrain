import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("internal agent product context", () => {
  it("describes the product generically and keeps local documents and memory governed", async () => {
    const source = await readFile(path.join(process.cwd(), "src/runtime/internal-agent-context.ts"), "utf8");
    const context = source.match(/`([\s\S]*?)`;/u)?.[1] ?? "";
    expect(context).toContain("modelos avanzados adecuados");
    expect(context).toContain("workspace local del servidor");
    expect(context).toContain("nunca se guarda automáticamente");
    expect(context).toContain("historial compartido del ordenador");
    expect(context).not.toMatch(/\bCodex\b|\bgpt-[0-9]|\bClaude\b|\bGemini\b/iu);
  });
});

