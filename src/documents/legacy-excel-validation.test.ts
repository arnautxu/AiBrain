import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ResourceLockManager } from "@/storage/resource-lock";
import { FileDocumentStagingStore } from "./staging-store";
import { prepareTurnDocumentWorkspaceInputs, ServerTurnDocumentInputResolver } from "./turn-attachments";
import { describe, it, expect } from "vitest";
import { validateUploadedDocument, validateUploadedDocumentFile } from "./upload-validation";

const fixture = () => readFile(path.resolve("tests/infra/fixtures/knowledge-legacy.xls"));
const validate = (data: Buffer, fileName = "horaris.xls", declaredMimeType = "application/vnd.ms-excel") =>
  validateUploadedDocument({ data, fileName, declaredMimeType });

describe("legacy Excel attachments", () => {
  it("accepts a real Unicode, multi-sheet BIFF8 workbook and preserves its original hash", async () => {
    const data = await fixture();
    const result = validate(data);
    expect(result).toMatchObject({ kind: "xls", mediaType: "application/vnd.ms-excel", size: data.length });
    const directory = await mkdtemp(path.join(tmpdir(), "xls-upload-"));
    try {
      const filePath = path.join(directory, "horaris.xls");
      await writeFile(filePath, data, { mode: 0o600 });
      const locks = new ResourceLockManager({ rootDirectory: path.join(directory, "locks") });
      const stagingRoot = path.join(directory, "staging");
      const store = new FileDocumentStagingStore(stagingRoot, locks);
      const document = await store.stage({ threadId: "11111111-1111-4111-8111-111111111111", uploadId: "22222222-2222-4222-8222-222222222222", validated: result, data });
      expect((await store.readById(document.threadId, document.uploadId)).kind).toBe("xls");
      const resolver = new ServerTurnDocumentInputResolver({ stagingRoot, pdftotext: "/unused", workspaceXlsx: true, previews: {
        read: async () => { throw new Error("Original workbook should be used"); },
        readFile: async () => { throw new Error("Original workbook should be used"); },
      } });
      const codexInputs = await resolver.resolve(document);
      const prepared = await prepareTurnDocumentWorkspaceInputs({ documents: [{ document, absolutePath: filePath, codexInputs }], projectWorkspace: directory, stagingRoot });
      expect(await readFile(path.join(prepared.directory!, "input-1.xls"))).toEqual(data);
      expect(await validateUploadedDocumentFile({ filePath, fileName: "horaris.xls", declaredMimeType: "application/vnd.ms-excel" })).toEqual(result);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("rejects disguised formats, truncated containers and cyclic allocation chains", async () => {
    const data = await fixture();
    expect(() => validate(data, "horaris.xlsx")).toThrow();
    expect(() => validate(data, "horaris.xls", "application/pdf")).toThrow();
    expect(() => validate(data.subarray(0, 512))).toThrow();
    const cyclic = Buffer.from(data);
    const fat = cyclic.readUInt32LE(76);
    const directory = cyclic.readUInt32LE(48);
    cyclic.writeUInt32LE(directory, (fat + 1) * 512 + directory * 4);
    expect(() => validate(cyclic)).toThrow();
  });
  it("rejects VBA storages, encryption and Excel 4 macro sheets", async () => {
    const data = await fixture();
    const directoryOffset = (data.readUInt32LE(48) + 1) * 512;
    const macro = Buffer.from(data);
    Buffer.from("_VBA_PROJECT_CUR\0", "utf16le").copy(macro, directoryOffset + 128);
    macro.writeUInt16LE(34, directoryOffset + 128 + 64);
    expect(() => validate(macro)).toThrow();
    const bof = data.indexOf(Buffer.from("0908100000060500", "hex"));
    expect(bof).toBeGreaterThan(0);
    const encrypted = Buffer.from(data);
    encrypted.writeUInt16LE(0x002f, bof + 20);
    expect(() => validate(encrypted)).toThrow();
    const macroSheet = Buffer.from(data);
    const sheetBof = data.indexOf(Buffer.from("0908100000061000", "hex"));
    expect(sheetBof).toBeGreaterThan(0);
    macroSheet.writeUInt16LE(0x0040, sheetBof + 6);
    expect(() => validate(macroSheet)).toThrow();
  });
});
