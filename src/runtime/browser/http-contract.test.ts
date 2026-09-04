import { describe, expect, it } from "vitest";
import {
  parseBrowserControlRequest,
  parseBrowserGatewayTokenRequest,
  parseBrowserViewerCommand,
} from "@/runtime/browser/http-contract";

const THREAD_ID = "0198b9f0-6631-7000-8000-000000000691";

describe("browser HTTP contracts", () => {
  it("accepts Unicode clipboard text including joiners and line breaks without accepting controls", () => {
    const command = { kind: "key", event: "char", key: "Unidentified", text: "Català ñ 日本語 👩🏽‍💻\nnext\tcell" };
    expect(parseBrowserViewerCommand({ threadId: THREAD_ID, action: "input", command })?.action).toBe("input");
    for (const text of ["\0", "\u001b", "\ud800", "x".repeat(4097)]) {
      expect(parseBrowserViewerCommand({ threadId: THREAD_ID, action: "input", command: { ...command, text } })).toBeNull();
    }
  });

  it("accepts only exact lifecycle and token requests", () => {
    expect(parseBrowserControlRequest({ action: "takeover" })).toEqual({ action: "takeover" });
    const binding = {
      attachmentId: "0198b9f0-6631-7000-8000-000000000692",
      browserSessionId: "0198b9f0-6631-7000-8000-000000000693",
    };
    expect(parseBrowserControlRequest({ action: "takeover", binding })).toEqual({ action: "takeover", binding });
    expect(parseBrowserControlRequest({ action: "release", binding: { ...binding, extra: true } })).toBeNull();
    expect(parseBrowserControlRequest({ action: "start", binding })).toBeNull();
    expect(parseBrowserControlRequest({ action: "takeover", userId: "foreign" })).toBeNull();
    expect(parseBrowserGatewayTokenRequest({
      threadId: THREAD_ID,
      capabilities: ["control", "view"],
      ttlMs: 30_000,
    })).toEqual({ threadId: THREAD_ID, capabilities: ["control", "view"], ttlMs: 30_000 });
    expect(parseBrowserGatewayTokenRequest({ threadId: THREAD_ID, capabilities: ["view", "view"] })).toBeNull();
  });

  it("normalizes navigation and bounds viewer input", () => {
    expect(parseBrowserViewerCommand({ threadId: THREAD_ID, action: "navigate", url: "https://example.test/path" }))
      .toEqual({ threadId: THREAD_ID, action: "navigate", url: "https://example.test/path" });
    expect(parseBrowserViewerCommand({ threadId: THREAD_ID, action: "navigate", url: "file:///etc/passwd" })).toBeNull();
    expect(parseBrowserViewerCommand({ threadId: THREAD_ID, action: "history", direction: "back" }))
      .toEqual({ threadId: THREAD_ID, action: "history", direction: "back" });
    expect(parseBrowserViewerCommand({ threadId: THREAD_ID, action: "history", direction: "evaluate" })).toBeNull();
    expect(parseBrowserViewerCommand({
      threadId: THREAD_ID,
      action: "input",
      command: { kind: "mouse", event: "mousePressed", x: 12, y: 24, button: "left", buttons: 1 },
    })).toEqual({
      threadId: THREAD_ID,
      action: "input",
      command: { kind: "mouse", event: "mousePressed", x: 12, y: 24, button: "left", buttons: 1 },
    });
    expect(parseBrowserViewerCommand({
      threadId: THREAD_ID,
      action: "input",
      command: { kind: "mouse", event: "mouseMoved", x: 12, y: 24, button: "left", buttons: 8 },
    })).toBeNull();
    expect(parseBrowserViewerCommand({
      threadId: THREAD_ID,
      action: "input",
      command: { kind: "mouse", event: "mouseReleased", x: 12, y: 24, button: "left" },
    })).toEqual({
      threadId: THREAD_ID,
      action: "input",
      command: { kind: "mouse", event: "mouseReleased", x: 12, y: 24, button: "left" },
    });
    expect(parseBrowserViewerCommand({
      threadId: THREAD_ID,
      action: "input",
      command: { kind: "key", event: "keyDown", key: "A", extra: true },
    })).toBeNull();
  });
});
