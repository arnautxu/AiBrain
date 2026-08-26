import { createHash } from "node:crypto";
import path from "node:path";

export type SupportedUploadKind = "docx" | "xlsx" | "pptx" | "pdf" | "text" | "image";

export type ValidatedUpload = {
  kind: SupportedUploadKind;
  fileName: string;
  mediaType: string;
  size: number;
  sha256: string;
  officeEntries: number | null;
};

export class UploadValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5_000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_ZIP_RATIO = 100;

type OfficeInspection = { kind: "docx" | "xlsx" | "pptx"; entries: number };

function safeFileName(value: string) {
  const normalized = value.normalize("NFC");
  if (
    normalized.length < 1
    || normalized.length > 120
    || normalized === "."
    || normalized === ".."
    || normalized !== path.basename(normalized)
    || normalized.includes("/")
    || normalized.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new UploadValidationError("UPLOAD_FILENAME_INVALID", "Upload filename is unsafe.");
  }
  return normalized;
}

function extension(fileName: string) {
  return path.extname(fileName).toLowerCase();
}

function startsWith(data: Uint8Array, bytes: readonly number[]) {
  return bytes.every((value, index) => data[index] === value);
}

function findEndOfCentralDirectory(data: Buffer) {
  const lowerBound = Math.max(0, data.length - 65_557);
  for (let offset = data.length - 22; offset >= lowerBound; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new UploadValidationError("UPLOAD_ZIP_INVALID", "OOXML archive has no valid central directory.");
}

function decodeZipName(value: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new UploadValidationError("UPLOAD_ZIP_INVALID", "OOXML archive contains a non-UTF-8 path.");
  }
}

function validateZipEntryName(name: string) {
  if (
    !name
    || name.startsWith("/")
    || name.includes("\\")
    || name.includes("\0")
    || path.posix.normalize(name) !== name
    || name.split("/").some((segment) => segment === "..")
  ) {
    throw new UploadValidationError("UPLOAD_ARCHIVE_TRAVERSAL", "OOXML archive contains an unsafe path.");
  }
}

function inspectOfficeArchive(data: Buffer): OfficeInspection {
  const end = findEndOfCentralDirectory(data);
  const disk = data.readUInt16LE(end + 4);
  const centralDisk = data.readUInt16LE(end + 6);
  const entriesOnDisk = data.readUInt16LE(end + 8);
  const entries = data.readUInt16LE(end + 10);
  const centralBytes = data.readUInt32LE(end + 12);
  const centralOffset = data.readUInt32LE(end + 16);
  const commentBytes = data.readUInt16LE(end + 20);
  if (
    disk !== 0
    || centralDisk !== 0
    || entriesOnDisk !== entries
    || entries > MAX_ZIP_ENTRIES
    || end + 22 + commentBytes !== data.length
    || centralOffset + centralBytes !== end
    || centralOffset > data.length
  ) {
    throw new UploadValidationError("UPLOAD_ZIP_INVALID", "OOXML central directory is unsupported or inconsistent.");
  }

  let offset = centralOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  const names = new Set<string>();
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) {
      throw new UploadValidationError("UPLOAD_ZIP_INVALID", "OOXML central directory entry is truncated.");
    }
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20);
    const uncompressed = data.readUInt32LE(offset + 24);
    const nameBytes = data.readUInt16LE(offset + 28);
    const extraBytes = data.readUInt16LE(offset + 30);
    const entryCommentBytes = data.readUInt16LE(offset + 32);
    const next = offset + 46 + nameBytes + extraBytes + entryCommentBytes;
    if (
      next > end
      || compressed === 0xffffffff
      || uncompressed === 0xffffffff
      || (flags & 0x1) !== 0
      || (method !== 0 && method !== 8)
    ) {
      throw new UploadValidationError("UPLOAD_ZIP_INVALID", "OOXML entry is encrypted, Zip64, truncated or uses an unsafe codec.");
    }
    const name = decodeZipName(data.subarray(offset + 46, offset + 46 + nameBytes));
    validateZipEntryName(name);
    const lower = name.toLowerCase();
    if (
      lower.endsWith("vbaproject.bin")
      || lower.includes("/activex/")
      || lower.startsWith("customui/")
      || lower.includes("/macrosheets/")
    ) {
      throw new UploadValidationError("UPLOAD_MACROS_REJECTED", "Macro-enabled or active OOXML content is not accepted.");
    }
    names.add(name);
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new UploadValidationError("UPLOAD_ARCHIVE_BOMB", "OOXML archive expands beyond the safety limit.");
    }
    offset = next;
  }
  if (offset !== end || totalUncompressed / Math.max(1, totalCompressed) > MAX_ZIP_RATIO) {
    throw new UploadValidationError("UPLOAD_ARCHIVE_BOMB", "OOXML archive compression ratio exceeds the safety limit.");
  }
  if (!names.has("[Content_Types].xml")) {
    throw new UploadValidationError("UPLOAD_OFFICE_INVALID", "OOXML archive lacks [Content_Types].xml.");
  }
  if ([...names].some((name) => name.startsWith("word/"))) return { kind: "docx", entries };
  if ([...names].some((name) => name.startsWith("xl/"))) return { kind: "xlsx", entries };
  if ([...names].some((name) => name.startsWith("ppt/"))) return { kind: "pptx", entries };
  throw new UploadValidationError("UPLOAD_OFFICE_INVALID", "OOXML archive is not DOCX, XLSX or PPTX.");
}

function detectedImageType(data: Buffer) {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function assertMimeAndExtension(
  fileName: string,
  declaredMimeType: string,
  kind: SupportedUploadKind,
  mediaType: string,
) {
  const ext = extension(fileName);
  const allowedExtensions: Record<SupportedUploadKind, readonly string[]> = {
    docx: [".docx"],
    xlsx: [".xlsx"],
    pptx: [".pptx"],
    pdf: [".pdf"],
    text: [".txt", ".md", ".csv", ".json"],
    image: mediaType === "image/jpeg" ? [".jpg", ".jpeg"] : [`.${mediaType.slice("image/".length)}`],
  };
  const officeMime: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  const mimeMatches = kind === "text"
    ? declaredMimeType.startsWith("text/") || declaredMimeType === "application/json"
    : declaredMimeType === (officeMime[kind] ?? mediaType);
  if (!allowedExtensions[kind].includes(ext) || !mimeMatches) {
    throw new UploadValidationError("UPLOAD_TYPE_MISMATCH", "Filename, declared MIME and file signature do not agree.");
  }
}

export function validateUploadedDocument(input: {
  fileName: string;
  declaredMimeType: string;
  data: Buffer;
}): ValidatedUpload {
  const fileName = safeFileName(input.fileName);
  const declaredMimeType = input.declaredMimeType.trim().toLowerCase();
  const data = input.data;
  if (data.length < 1 || data.length > MAX_FILE_BYTES) {
    throw new UploadValidationError("UPLOAD_SIZE_INVALID", "Upload size is outside the safety limit.");
  }

  let kind: SupportedUploadKind;
  let mediaType: string;
  let officeEntries: number | null = null;
  if (data.subarray(0, 5).toString("ascii") === "%PDF-") {
    kind = "pdf";
    mediaType = "application/pdf";
  } else if (startsWith(data, [0x50, 0x4b])) {
    const office = inspectOfficeArchive(data);
    kind = office.kind;
    officeEntries = office.entries;
    mediaType = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }[kind];
  } else {
    const imageType = detectedImageType(data);
    if (imageType) {
      kind = "image";
      mediaType = imageType;
      if (data.length > MAX_IMAGE_BYTES) {
        throw new UploadValidationError("UPLOAD_SIZE_INVALID", "Image exceeds the safety limit.");
      }
    } else {
      if (data.length > MAX_TEXT_BYTES || data.includes(0)) {
        throw new UploadValidationError("UPLOAD_TYPE_UNSUPPORTED", "Upload is not a supported text or document format.");
      }
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        throw new UploadValidationError("UPLOAD_TYPE_UNSUPPORTED", "Text upload must be valid UTF-8.");
      }
      kind = "text";
      mediaType = declaredMimeType === "application/json" ? "application/json" : "text/plain";
    }
  }
  assertMimeAndExtension(fileName, declaredMimeType, kind, mediaType);
  return {
    kind,
    fileName,
    mediaType,
    size: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    officeEntries,
  };
}
