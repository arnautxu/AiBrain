import { describe, expect, it } from "vitest";
import { privateWorkspaceSafeText } from "@/runtime/private-workspace-text";
import { completePublicTextPrefix, publicAssistantText } from "@/ui/public-activity";

describe("known private workspace prefixes", () => {
  it("preserves downloadable artifact links while redacting standalone internal ids", () => {
    const id = "07267fd4-0bc1-4b34-9a4c-3a023c27172b";
    const artifact = "d1358f70-ef69-434e-823b-ade88f4f21ca";
    const url = `/api/threads/${id}/artifacts/${artifact}?download=1`;
    expect(publicAssistantText(`[Descargar](${url})\nInterno: ${id}`, "Asistente"))
      .toBe(`[Descargar](${url})\nInterno: identificador interno`);
  });

  it.each([
    '/tmp/aibrain QA_PRIVATE_MARKER tail-abc/workspace',
    '/tmp/aibrain "QA_PRIVATE_MARKER" tail-abc/workspace',
    "/tmp/aibrain 'QA_PRIVATE_MARKER' tail-abc/workspace",
  ])("withholds every partial root and replaces the complete root: %s", (root) => {
    const roots = [root, '/tmp/aibrain'];
    for (const wrapper of ['', '"', "'", '`', '(']) {
      const start = `Archivo ${wrapper}`;
      // Every cumulative character prefix covers all possible chunk splits.
      for (let split = 1; split < root.length; split++) {
        const safe = privateWorkspaceSafeText(start + root.slice(0, split), roots);
        expect(safe).toBe(split === 1 ? start + '/' : start);
        expect(publicAssistantText(completePublicTextPrefix(safe), 'Asistente'))
          .not.toContain('QA_PRIVATE_MARKER');
      }
      expect(privateWorkspaceSafeText(`${start}${root}/informe.pdf`, roots))
        .toBe(`${start}./informe.pdf`);
    }
  });

  it("keeps ordinary progressive text and replaces repeated roots", () => {
    const root = '/tmp/QA_PRIVATE_MARKER tail';
    expect(completePublicTextPrefix(privateWorkspaceSafeText('Primera palabra', [root])))
      .toBe('Primera ');
    expect(privateWorkspaceSafeText(`${root}/a y ${root}/b`, [root])).toBe('./a y ./b');
    expect(privateWorkspaceSafeText('Texto y https://example.com/docs/', [root]))
      .toBe('Texto y https://example.com/docs/');
  });
});
