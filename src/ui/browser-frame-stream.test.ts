import { describe, expect, it } from "vitest";
import {
  BROWSER_FRAME_STREAM_CONTENT_TYPE,
  BrowserFrameStreamDecoder,
  consumeBrowserFrameStream,
  encodeBrowserFrameStreamRecord,
  type BrowserFrameStreamRecord,
} from "@/ui/browser-frame-stream";

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02,
]);

function frame(sequence = 1): BrowserFrameStreamRecord {
  return {
    metadata: {
      version: 1,
      kind: "frame",
      sequence,
      capturedAt: "2026-08-30T10:00:00.000Z",
      captureDurationMs: 32,
      mediaType: "image/png",
      pointerTrail: [{ id: "click-1", x: 25, y: 40 }],
    },
    data: png,
  };
}

function heartbeat(sequence = 1): BrowserFrameStreamRecord {
  return {
    metadata: {
      version: 1,
      kind: "heartbeat",
      sequence,
      capturedAt: "2026-08-30T10:00:02.500Z",
      captureDurationMs: 24,
      mediaType: null,
      pointerTrail: [],
    },
    data: new Uint8Array(0),
  };
}

describe("browser frame stream protocol", () => {
  it("decodes fragmented changed frames and idle heartbeats without buffering the response", () => {
    const payload = new Uint8Array([
      ...encodeBrowserFrameStreamRecord(frame()),
      ...encodeBrowserFrameStreamRecord(heartbeat()),
      ...encodeBrowserFrameStreamRecord(frame(2)),
    ]);
    const decoder = new BrowserFrameStreamDecoder();
    const records = [
      ...decoder.push(payload.subarray(0, 3)),
      ...decoder.push(payload.subarray(3, 37)),
      ...decoder.push(payload.subarray(37)),
    ];
    decoder.finish();
    expect(records.map(({ metadata }) => [metadata.kind, metadata.sequence])).toEqual([
      ["frame", 1], ["heartbeat", 1], ["frame", 2],
    ]);
    expect(records[0]?.data).toEqual(png);
    expect(records[0]?.metadata.pointerTrail).toEqual([{ id: "click-1", x: 25, y: 40 }]);
  });

  it("consumes a streaming HTTP response and rejects incomplete EOFs", async () => {
    const encoded = encodeBrowserFrameStreamRecord(frame());
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.subarray(0, 5));
        controller.enqueue(encoded.subarray(5));
        controller.close();
      },
    }), { headers: { "Content-Type": BROWSER_FRAME_STREAM_CONTENT_TYPE } });
    const seen: BrowserFrameStreamRecord[] = [];
    await consumeBrowserFrameStream(response, (record) => { seen.push(record); });
    expect(seen).toHaveLength(1);

    const truncated = new BrowserFrameStreamDecoder();
    truncated.push(encoded.subarray(0, encoded.length - 1));
    expect(() => truncated.finish()).toThrow(/incompleto/i);
  });

  it("rejects non-PNG payloads and oversized or malformed metadata", () => {
    expect(() => encodeBrowserFrameStreamRecord({ ...frame(), data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }))
      .toThrow(/invalid/i);
    expect(() => encodeBrowserFrameStreamRecord({
      ...frame(),
      metadata: { ...frame().metadata, pointerTrail: [{ id: "outside", x: 101, y: 50 }] },
    })).toThrow(/contrato seguro/i);
    const invalid = encodeBrowserFrameStreamRecord(frame());
    invalid[8] = 0xff;
    expect(() => new BrowserFrameStreamDecoder().push(invalid)).toThrow(/metadatos/i);
  });
});
