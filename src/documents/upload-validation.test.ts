import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { validateUploadedDocument, validateUploadedDocumentFile } from "@/documents/upload-validation";

function testCrc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries: Array<{ name: string; data: Buffer; declaredSize?: number; method?: 0 | 8 }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method ?? 0;
    const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const uncompressedSize = entry.declaredSize ?? entry.data.length;
    const crc32 = testCrc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + name.length + payload.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

const officeMimes = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

describe("document upload validation", () => {
  it.each([
    ["docx", "word/document.xml"],
    ["xlsx", "xl/workbook.xml"],
    ["pptx", "ppt/presentation.xml"],
  ] as const)("recognizes a minimal valid %s package", (kind, part) => {
    const data = storedZip([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: part, data: Buffer.from("<root/>") },
    ]);
    expect(validateUploadedDocument({
      fileName: `example.${kind}`,
      declaredMimeType: officeMimes[kind],
      data,
    })).toMatchObject({ kind, officeEntries: 2, size: data.length });
  });

  it("rejects traversal and macro payloads inside OOXML", () => {
    const base = { name: "[Content_Types].xml", data: Buffer.from("<Types/>") };
    expect(() => validateUploadedDocument({
      fileName: "unsafe.docx",
      declaredMimeType: officeMimes.docx,
      data: storedZip([base, { name: "../word/document.xml", data: Buffer.from("x") }]),
    })).toThrowError(expect.objectContaining({ code: "UPLOAD_ARCHIVE_TRAVERSAL" }));
    expect(() => validateUploadedDocument({
      fileName: "macro.docx",
      declaredMimeType: officeMimes.docx,
      data: storedZip([base, { name: "word/vbaProject.bin", data: Buffer.from("x") }]),
    })).toThrowError(expect.objectContaining({ code: "UPLOAD_MACROS_REJECTED" }));
  });

  it("rejects archive bombs before extraction", () => {
    expect(() => validateUploadedDocument({
      fileName: "bomb.docx",
      declaredMimeType: officeMimes.docx,
      data: storedZip([
        { name: "[Content_Types].xml", data: Buffer.from("x") },
        { name: "word/document.xml", data: Buffer.from("x"), declaredSize: 300 * 1024 * 1024 },
      ]),
    })).toThrowError(expect.objectContaining({ code: "UPLOAD_ARCHIVE_BOMB" }));
  });

  it("rejects false MIME, unsafe names and unsupported macro extensions", () => {
    const pdf = Buffer.from("%PDF-1.7\n%%EOF\n");
    expect(() => validateUploadedDocument({
      fileName: "report.pdf",
      declaredMimeType: "image/png",
      data: pdf,
    })).toThrowError(expect.objectContaining({ code: "UPLOAD_TYPE_MISMATCH" }));
    expect(() => validateUploadedDocument({
      fileName: "../report.pdf",
      declaredMimeType: "application/pdf",
      data: pdf,
    })).toThrowError(expect.objectContaining({ code: "UPLOAD_FILENAME_INVALID" }));
    expect(() => validateUploadedDocument({
      fileName: "macro.docm",
      declaredMimeType: officeMimes.docx,
      data: storedZip([
        { name: "[Content_Types].xml", data: Buffer.from("x") },
        { name: "word/document.xml", data: Buffer.from("x") },
      ]),
    })).toThrowError(expect.objectContaining({ code: "UPLOAD_TYPE_MISMATCH" }));
  });

  it("accepts PDF, UTF-8 text and real image signatures", () => {
    expect(validateUploadedDocument({
      fileName: "report.pdf",
      declaredMimeType: "application/pdf",
      data: Buffer.from("%PDF-1.7\n%%EOF\n"),
    }).kind).toBe("pdf");
    expect(validateUploadedDocument({
      fileName: "notes.md",
      declaredMimeType: "text/markdown",
      data: Buffer.from("hello"),
    }).kind).toBe("text");
    expect(validateUploadedDocument({
      fileName: "pixel.png",
      declaredMimeType: "image/png",
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
    }).kind).toBe("image");
  });

  it("validates and hashes OOXML from bounded file reads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-file-validation-"));
    try {
      const data = storedZip([
        { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
        { name: "word/document.xml", data: Buffer.from("<root/>") },
      ]);
      const filePath = path.join(root, "incoming.upload");
      await writeFile(filePath, data, { mode: 0o600 });
      await expect(validateUploadedDocumentFile({
        fileName: "example.docx",
        declaredMimeType: officeMimes.docx,
        filePath,
      })).resolves.toMatchObject({
        kind: "docx",
        size: data.length,
        officeEntries: 2,
        sha256: validateUploadedDocument({
          fileName: "example.docx",
          declaredMimeType: officeMimes.docx,
          data,
        }).sha256,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid UTF-8 while streaming a private file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-file-validation-"));
    try {
      const filePath = path.join(root, "incoming.upload");
      await writeFile(filePath, Buffer.from([0x61, 0xc3, 0x28]), { mode: 0o600 });
      await expect(validateUploadedDocumentFile({
        fileName: "notes.txt",
        declaredMimeType: "text/plain",
        filePath,
      })).rejects.toMatchObject({ code: "UPLOAD_TYPE_UNSUPPORTED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects dishonest deflate metadata using actual streamed expansion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-file-validation-"));
    try {
      const filePath = path.join(root, "incoming.upload");
      await writeFile(filePath, storedZip([
        { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
        { name: "word/document.xml", data: Buffer.alloc(1024 * 1024), declaredSize: 1, method: 8 },
      ]), { mode: 0o600 });
      await expect(validateUploadedDocumentFile({
        fileName: "bomb.docx",
        declaredMimeType: officeMimes.docx,
        filePath,
      })).rejects.toMatchObject({ code: "UPLOAD_ARCHIVE_BOMB" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects inconsistent and truncated local OOXML records", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-file-validation-"));
    try {
      const original = storedZip([
        { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
        { name: "word/document.xml", data: Buffer.from("<root/>") },
      ]);
      const inconsistentPath = path.join(root, "inconsistent.upload");
      const inconsistent = Buffer.from(original);
      inconsistent.writeUInt16LE(8, 8);
      await writeFile(inconsistentPath, inconsistent, { mode: 0o600 });
      await expect(validateUploadedDocumentFile({
        fileName: "inconsistent.docx",
        declaredMimeType: officeMimes.docx,
        filePath: inconsistentPath,
      })).rejects.toMatchObject({ code: "UPLOAD_ZIP_INVALID" });

      const truncatedPath = path.join(root, "truncated.upload");
      const truncated = Buffer.from(original);
      truncated.writeUInt32LE(0x7fffffff, 18);
      await writeFile(truncatedPath, truncated, { mode: 0o600 });
      await expect(validateUploadedDocumentFile({
        fileName: "truncated.docx",
        declaredMimeType: officeMimes.docx,
        filePath: truncatedPath,
      })).rejects.toMatchObject({ code: "UPLOAD_ZIP_INVALID" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
