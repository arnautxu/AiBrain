import { describe, expect, it } from "vitest";
import { isChatInputAttachment, isTurnOptions } from "@/lib/chat-contract";

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
});
