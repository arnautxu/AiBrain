import { describe, expect, it } from "vitest";
import {
  applyChatStreamEvent,
  isChatInputAttachment,
  isChatStreamEvent,
  isToolResult,
  isTurnOptions,
  isTurnSource,
  type ChatMessage,
} from "@/lib/chat-contract";

function dataUrl(mimeType: string, bytes: readonly number[]) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("chat attachment contract", () => {
  it("accepts a canonical image and rejects false MIME, false size and malformed base64", () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
    const valid = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "image.png",
      mimeType: "image/png",
      size: png.length,
      dataUrl: dataUrl("image/png", png),
    };
    expect(isChatInputAttachment(valid)).toBe(true);
    expect(isChatInputAttachment({ ...valid, mimeType: "image/jpeg", dataUrl: dataUrl("image/jpeg", png) })).toBe(false);
    expect(isChatInputAttachment({ ...valid, size: png.length + 1 })).toBe(false);
    expect(isChatInputAttachment({ ...valid, dataUrl: "data:image/png;base64,%%%%" })).toBe(false);
  });

  it("accepts a unique bounded staged document id set and rejects duplicates", () => {
    const base = {
      mode: "agent",
      model: null,
      effort: null,
      webSearch: false,
      imageGeneration: false,
      skill: null,
      attachments: [],
    };
    const uploadId = "22222222-2222-4222-8222-222222222222";
    expect(isTurnOptions({ ...base, documentUploadIds: [uploadId] })).toBe(true);
    expect(isTurnOptions({ ...base, documentUploadIds: [uploadId, uploadId] })).toBe(false);
    expect(isTurnOptions({ ...base, documentUploadIds: ["../escape"] })).toBe(false);
  });

  it("accepts only unique catalog connector mentions", () => {
    const base = { mode: "agent", model: null, effort: null, webSearch: false, imageGeneration: false, skill: null, attachments: [] };
    expect(isTurnOptions({ ...base, connectorMentions: ["gmail", "calendar-company"] })).toBe(true);
    expect(isTurnOptions({ ...base, connectorMentions: ["gmail", "gmail"] })).toBe(false);
    expect(isTurnOptions({ ...base, connectorMentions: ["../another-user"] })).toBe(false);
  });
});

describe("turn evidence contract", () => {
  const source = {
    id: "source-123",
    kind: "web",
    title: "Informe oficial",
    url: "https://example.com/informe",
    domain: "example.com",
    snippet: "Resumen entregado por el runtime.",
    publishedAt: "2026-08-20T00:00:00.000Z",
  } as const;
  const result = {
    id: "tool-123",
    kind: "web",
    title: "Búsqueda: informe",
    status: "complete",
    summary: "1 fuente consultada",
    output: null,
    sourceIds: [source.id] as string[],
    createdAt: "2026-08-28T00:00:00.000Z",
  } as const;

  it("accepts safe source and tool metadata and rejects invented or unsafe locations", () => {
    expect(isTurnSource(source)).toBe(true);
    expect(isTurnSource({ ...source, url: "javascript:alert(1)" })).toBe(false);
    expect(isTurnSource({ ...source, publishedAt: "ayer" })).toBe(false);
    expect(isToolResult(result)).toBe(true);
    expect(isToolResult({ ...result, sourceIds: [source.id, source.id] })).toBe(false);
    expect(isChatStreamEvent({ type: "source", item: source })).toBe(true);
    expect(isChatStreamEvent({ type: "toolResult", item: result })).toBe(true);
  });

  it("upserts sources and tool results without duplicating replayed events", () => {
    const message: ChatMessage = {
      id: "11111111-1111-4111-8111-111111111111", role: "assistant", content: "",
      createdAt: "2026-08-28T00:00:00.000Z", status: "streaming", activity: [], plan: [],
      approvals: [], diff: "", attachments: [], artifacts: [], sources: [], toolResults: [],
    };
    const withSource = applyChatStreamEvent(message, { type: "source", item: source });
    const replayed = applyChatStreamEvent(withSource, { type: "source", item: { ...source, snippet: "Actualizado" } });
    const withResult = applyChatStreamEvent(replayed, { type: "toolResult", item: result });
    expect(withResult.sources).toEqual([{ ...source, snippet: "Actualizado" }]);
    expect(withResult.toolResults).toEqual([result]);
  });
});

describe("generated image artifact contract", () => {
  const artifact = {
    id: "11111111-1111-4111-8111-111111111119",
    type: "image",
    name: "imagen-11111111.png",
    url: "/api/projects/11111111-1111-4111-8111-111111111118/artifacts/11111111-1111-4111-8111-111111111119",
    prompt: null,
  } as const;

  it("accepts only an opaque authenticated PNG URL and a single .png suffix", () => {
    expect(isChatStreamEvent({ type: "artifact", item: artifact })).toBe(true);
    expect(isChatStreamEvent({ type: "artifact", item: { ...artifact, name: `${artifact.name}.json` } })).toBe(false);
    expect(isChatStreamEvent({ type: "artifact", item: { ...artifact, name: "image.json" } })).toBe(false);
    expect(isChatStreamEvent({ type: "artifact", item: { ...artifact, url: "/workspace/.aibrain/artifacts/image.png" } })).toBe(false);
    expect(isChatStreamEvent({ type: "artifact", item: { ...artifact, url: `${artifact.url}?path=/tmp/image.png` } })).toBe(false);
  });
});
