import { describe, expect, it } from "vitest";
import { privateWorkspaceSafeText } from "@/runtime/private-workspace-text";
import { completePublicTextPrefix, publicAssistantText } from "@/ui/public-activity";

describe("known private workspace prefixes", () => {
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
