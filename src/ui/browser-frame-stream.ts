export const BROWSER_FRAME_STREAM_CONTENT_TYPE = "application/vnd.aibrain.browser-frames";

const HEADER_BYTES = 8;
const MAX_METADATA_BYTES = 1_024;
const MAX_FRAME_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type BrowserFrameStreamMetadata = Readonly<{
  version: 1;
  kind: "frame" | "heartbeat";
  sequence: number;
  capturedAt: string;
  captureDurationMs: number;
  mediaType: "image/png" | null;
}>;

export type BrowserFrameStreamRecord = Readonly<{
  metadata: BrowserFrameStreamMetadata;
  data: Uint8Array;
}>;

function exactRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["captureDurationMs", "capturedAt", "kind", "mediaType", "sequence", "version"];
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]) ? record : null;
}

function parseMetadata(value: unknown, dataLength: number): BrowserFrameStreamMetadata {
  const record = exactRecord(value);
  if (!record || record.version !== 1 ||
    (record.kind !== "frame" && record.kind !== "heartbeat") ||
    !Number.isSafeInteger(record.sequence) || Number(record.sequence) < 0 ||
    typeof record.capturedAt !== "string" || !Number.isFinite(Date.parse(record.capturedAt)) ||
    typeof record.captureDurationMs !== "number" || !Number.isFinite(record.captureDurationMs) ||
    record.captureDurationMs < 0 || record.captureDurationMs > 60_000 ||
    !((record.kind === "frame" && record.mediaType === "image/png" && dataLength >= PNG_SIGNATURE.length) ||
      (record.kind === "heartbeat" && record.mediaType === null && dataLength === 0))) {
    throw new Error("El stream del navegador no cumple el contrato seguro.");
  }
  return record as BrowserFrameStreamMetadata;
}

function isPng(data: Uint8Array) {
  return PNG_SIGNATURE.every((value, index) => data[index] === value);
}

export function encodeBrowserFrameStreamRecord(record: BrowserFrameStreamRecord) {
  const metadata = encoder.encode(JSON.stringify(record.metadata));
  if (metadata.byteLength > MAX_METADATA_BYTES || record.data.byteLength > MAX_FRAME_BYTES ||
    (record.metadata.kind === "frame" && !isPng(record.data)) ||
    (record.metadata.kind === "heartbeat" && record.data.byteLength !== 0)) {
    throw new Error("Browser frame stream record is invalid.");
  }
  const result = new Uint8Array(HEADER_BYTES + metadata.byteLength + record.data.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, metadata.byteLength, false);
  view.setUint32(4, record.data.byteLength, false);
  result.set(metadata, HEADER_BYTES);
  result.set(record.data, HEADER_BYTES + metadata.byteLength);
  return result;
}

export class BrowserFrameStreamDecoder {
  private buffered = new Uint8Array(0);

  push(chunk: Uint8Array): BrowserFrameStreamRecord[] {
    if (chunk.byteLength === 0) return [];
    if (this.buffered.byteLength + chunk.byteLength > HEADER_BYTES + MAX_METADATA_BYTES + MAX_FRAME_BYTES) {
      throw new Error("El stream del navegador supera el límite seguro.");
    }
    const combined = new Uint8Array(this.buffered.byteLength + chunk.byteLength);
    combined.set(this.buffered);
    combined.set(chunk, this.buffered.byteLength);
    this.buffered = combined;
    const records: BrowserFrameStreamRecord[] = [];
    for (;;) {
      if (this.buffered.byteLength < HEADER_BYTES) break;
      const view = new DataView(this.buffered.buffer, this.buffered.byteOffset, this.buffered.byteLength);
      const metadataLength = view.getUint32(0, false);
      const dataLength = view.getUint32(4, false);
      if (metadataLength < 1 || metadataLength > MAX_METADATA_BYTES || dataLength > MAX_FRAME_BYTES) {
        throw new Error("El stream del navegador contiene un frame inválido.");
      }
      const recordLength = HEADER_BYTES + metadataLength + dataLength;
      if (this.buffered.byteLength < recordLength) break;
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoder.decode(this.buffered.subarray(HEADER_BYTES, HEADER_BYTES + metadataLength)));
      } catch {
        throw new Error("El stream del navegador contiene metadatos inválidos.");
      }
      const data = this.buffered.slice(HEADER_BYTES + metadataLength, recordLength);
      const metadata = parseMetadata(parsed, data.byteLength);
      if (metadata.kind === "frame" && !isPng(data)) {
        throw new Error("El stream del navegador ha devuelto una imagen inválida.");
      }
      records.push(Object.freeze({ metadata, data }));
      this.buffered = this.buffered.slice(recordLength);
    }
    return records;
  }

  finish() {
    if (this.buffered.byteLength !== 0) {
      throw new Error("El stream del navegador terminó con un frame incompleto.");
    }
  }
}

export async function consumeBrowserFrameStream(
  response: Response,
  onRecord: (record: BrowserFrameStreamRecord) => void | Promise<void>,
  signal?: AbortSignal,
) {
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim() ?? "";
  if (!response.ok || contentType !== BROWSER_FRAME_STREAM_CONTENT_TYPE || !response.body) {
    throw new Error("No se ha podido abrir el stream privado del navegador.");
  }
  const reader = response.body.getReader();
  const streamDecoder = new BrowserFrameStreamDecoder();
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      for (const record of streamDecoder.push(value)) await onRecord(record);
    }
    streamDecoder.finish();
  } finally {
    reader.releaseLock();
  }
}
