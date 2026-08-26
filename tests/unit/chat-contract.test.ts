import { describe, expect, it } from "vitest";
import {
  isChatAttachment,
  isChatInputAttachment,
  isTurnOptions,
} from "@/lib/chat-contract";

const attachment = {
  id: "018f5f68-4a6e-7abc-8def-0123456789ab",
  name: "synthetic.png",
  mimeType: "image/png",
  size: 128,
};

describe("chat contract", () => {
  it("accepts the bounded synthetic image attachment", () => {
    expect(isChatAttachment(attachment)).toBe(true);
    expect(isChatInputAttachment({
      ...attachment,
      dataUrl: "data:image/png;base64,c3ludGhldGlj",
    })).toBe(true);
  });

  it("rejects files outside the current image-only boundary", () => {
    expect(isChatAttachment({ ...attachment, mimeType: "application/pdf" })).toBe(false);
    expect(isChatAttachment({ ...attachment, size: 2_000_001 })).toBe(false);
  });

  it("rejects aggregate attachment payloads above the server limit", () => {
    const large = {
      ...attachment,
      size: 1_800_000,
      dataUrl: "data:image/png;base64,c3ludGhldGlj",
    };
    expect(isTurnOptions({
      mode: "agent",
      model: null,
      effort: null,
      webSearch: false,
      imageGeneration: false,
      skill: null,
      attachments: [large, { ...large, id: "018f5f68-4a6e-7abc-8def-0123456789ac" }, { ...large, id: "018f5f68-4a6e-7abc-8def-0123456789ad" }],
    })).toBe(false);
  });
});
