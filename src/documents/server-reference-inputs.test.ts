import { describe, expect, it, vi } from "vitest";
import { serverReferenceInputs } from "./server-reference-inputs";
import { isServerReferenceList, type ServerReference } from "./server-reference-contract";
const file: ServerReference = { path: "server-arnall/Y/QA.txt", name: "QA.txt", kind: "file", modifiedAt: "2026-09-01T00:00:00Z", size: 1 };
const roots = [{ scope: "company" as const, scopeId: null, path: "/unused", readOnly: true }];
describe("selected server references", () => {
  it("reads latest content and records its version instead of trusting selection metadata", async () => {
    const read = vi.fn().mockResolvedValue({ available: true, content: "externally updated", sha256: "a".repeat(64), size: 9, modifiedAt: "2026-09-07T00:00:00Z", checkedAt: "2026-09-07T12:00:00Z", part: 1, parts: 1 });
    const result = await serverReferenceInputs([file], roots, { read, search: vi.fn().mockResolvedValue({ available: true, sourceChecked: true, results: [] }) });
    expect(read).toHaveBeenCalledWith(roots, { scope: "company", path: file.path });
    expect(result[0].text).toContain("externally updated");
    expect(result[0].text).toContain('"changedSinceSelection":true');
    expect(result[0].text).toContain("copia nueva");
  });
  it("folders stay references with no recursive content loading; denied scope performs no read", async () => {
    const read = vi.fn();
    const result = await serverReferenceInputs([{ ...file, kind: "directory" }], roots, { read, search: vi.fn().mockResolvedValue({ available: true, sourceChecked: true, results: [] }) });
    expect(result[0].text).toContain("no se han cargado");
    expect(read).not.toHaveBeenCalled();
    await expect(serverReferenceInputs([file], [], { read, search: vi.fn().mockResolvedValue({ available: true, sourceChecked: true, results: [] }) })).rejects.toThrow("permiso");
    expect(read).not.toHaveBeenCalled();
  });
  it("fails closed for withdrawn or unreadable files and malformed references", async () => {
    await expect(serverReferenceInputs([file], roots, { read: vi.fn().mockResolvedValue({ available: false }), search: vi.fn() })).rejects.toThrow("Windows");
    for (const path of ["server-other/../Y/x", "server-arnall/Y/%2e%2e/x", "server-arnall/Y/a%2fb", "server-arnall/Y/a:stream", "server-arnall/Y/QA.txt?part=2"]) {
      expect(isServerReferenceList([{ ...file, path }])).toBe(false);
    }
    expect(isServerReferenceList([file, file])).toBe(false);
    expect(isServerReferenceList([{ ...file, write: true }])).toBe(false);
  });
});
