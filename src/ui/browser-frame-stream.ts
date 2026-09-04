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
  pointerTrail: readonly Readonly<{ id: string; x: number; y: number }>[];
}>;

export type BrowserFrameStreamRecord = Readonly<{
  metadata: BrowserFrameStreamMetadata;
  data: Uint8Array;
}>;

function exactRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["captureDurationMs", "capturedAt", "kind", "mediaType", "pointerTrail", "sequence", "version"];
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]) ? record : null;
}

function parsePointerTrail(value: unknown) {
  if (!Array.isArray(value) || value.length > 3) return null;
  const points: Array<Readonly<{ id: string; x: number; y: number }>> = [];
  for (const valuePoint of value) {
    if (!valuePoint || typeof valuePoint !== "object" || Array.isArray(valuePoint)) return null;
    const point = valuePoint as Record<string, unknown>;
    const keys = Object.keys(point).sort();
    if (keys.join(",") !== "id,x,y" || typeof point.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(point.id) ||
      typeof point.x !== "number" || !Number.isFinite(point.x) || point.x < 0 || point.x > 100 ||
      typeof point.y !== "number" || !Number.isFinite(point.y) || point.y < 0 || point.y > 100) return null;
    points.push(Object.freeze({ id: point.id, x: point.x, y: point.y }));
  }
  return Object.freeze(points);
}

function parseMetadata(value: unknown, dataLength: number): BrowserFrameStreamMetadata {
  const record = exactRecord(value);
  const pointerTrail = parsePointerTrail(record?.pointerTrail);
  if (!record || record.version !== 1 ||
    (record.kind !== "frame" && record.kind !== "heartbeat") ||
    !Number.isSafeInteger(record.sequence) || Number(record.sequence) < 0 ||
    typeof record.capturedAt !== "string" || !Number.isFinite(Date.parse(record.capturedAt)) ||
    typeof record.captureDurationMs !== "number" || !Number.isFinite(record.captureDurationMs) ||
    record.captureDurationMs < 0 || record.captureDurationMs > 60_000 ||
    !pointerTrail ||
    !((record.kind === "frame" && record.mediaType === "image/png" && dataLength >= PNG_SIGNATURE.length) ||
      (record.kind === "heartbeat" && record.mediaType === null && dataLength === 0))) {
    throw new Error("El stream del navegador no cumple el contrato seguro.");
  }
  return Object.freeze({ ...record, pointerTrail }) as BrowserFrameStreamMetadata;
}

function isPng(data: Uint8Array) {
  return PNG_SIGNATURE.every((value, index) => data[index] === value);
}

export function encodeBrowserFrameStreamRecord(record: BrowserFrameStreamRecord) {
  parseMetadata(record.metadata, record.data.byteLength);
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
  private readonly header = new Uint8Array(HEADER_BYTES);
  private headerLength = 0;
  private payload: Uint8Array | null = null;
  private payloadLength = 0;
  private metadataLength = 0;

  push(chunk: Uint8Array): BrowserFrameStreamRecord[] {
    const records: BrowserFrameStreamRecord[] = [];
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (this.headerLength < HEADER_BYTES) {
        const count = Math.min(HEADER_BYTES - this.headerLength, chunk.byteLength - offset);
        this.header.set(chunk.subarray(offset, offset + count), this.headerLength);
        this.headerLength += count;
        offset += count;
        if (this.headerLength < HEADER_BYTES) break;
        const view = new DataView(this.header.buffer);
        this.metadataLength = view.getUint32(0, false);
        const dataLength = view.getUint32(4, false);
        if (this.metadataLength < 1 || this.metadataLength > MAX_METADATA_BYTES || dataLength > MAX_FRAME_BYTES) {
          throw new Error("El stream del navegador contiene un frame inválido.");
        }
        // Allocate once after validating the header. Repeatedly joining the
        // partial frame copies quadratic bytes on fragmented network streams.
        this.payload = new Uint8Array(this.metadataLength + dataLength);
      }
      const payload = this.payload!;
      const count = Math.min(payload.byteLength - this.payloadLength, chunk.byteLength - offset);
      payload.set(chunk.subarray(offset, offset + count), this.payloadLength);
      this.payloadLength += count;
      offset += count;
      if (this.payloadLength < payload.byteLength) break;
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoder.decode(payload.subarray(0, this.metadataLength)));
      } catch {
        throw new Error("El stream del navegador contiene metadatos inválidos.");
      }
      // This payload is never reused, so the record can own its data view.
      const data = payload.subarray(this.metadataLength);
      const metadata = parseMetadata(parsed, data.byteLength);
      if (metadata.kind === "frame" && !isPng(data)) {
        throw new Error("El stream del navegador ha devuelto una imagen inválida.");
      }
      records.push(Object.freeze({ metadata, data }));
      this.headerLength = 0;
      this.payloadLength = 0;
      this.payload = null;
    }
    return records;
  }

  finish() {
    if (this.headerLength !== 0 || this.payload !== null) {
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
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (done) break;
      for (const record of streamDecoder.push(value)) await onRecord(record);
    }
    streamDecoder.finish();
  } finally {
    signal?.removeEventListener("abort", abort);
    // A parser/renderer failure must detach the server capture loop as well.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
