import { describe, expect, it, vi } from "vitest";
import { ChatStreamProtocolError, consumeChatEventStream } from "@/ui/app-server-ui-adapter";

function responseFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }));
}

describe("App Server UI stream adapter", () => {
  it("preserves event order across arbitrary NDJSON chunk boundaries", async () => {
    const onEvent = vi.fn();
    await consumeChatEventStream(responseFromChunks([
      '{"type":"delta","value":"Ho',
      'la "}\n{"type":"delta","value":"mundo"}\n',
      '{"type":"done"}',
    ]), onEvent);

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: "delta", value: "Hola " },
      { type: "delta", value: "mundo" },
      { type: "done" },
    ]);
  });

  it("fails closed on unknown or malformed events", async () => {
    await expect(consumeChatEventStream(
      responseFromChunks(['{"type":"invented"}\n']),
      () => undefined,
    )).rejects.toBeInstanceOf(ChatStreamProtocolError);
    await expect(consumeChatEventStream(
      responseFromChunks(["not-json\n"]),
      () => undefined,
    )).rejects.toBeInstanceOf(ChatStreamProtocolError);
  });
});
