import { describe, expect, it } from "vitest";
import {
  parseBrowserControlRequest,
  parseBrowserGatewayTokenRequest,
  parseBrowserViewerCommand,
} from "@/runtime/browser/http-contract";

describe("browser HTTP contracts", () => {
  it("accepts only exact lifecycle and token requests", () => {
    expect(parseBrowserControlRequest({ action: "takeover" })).toEqual({ action: "takeover" });
    expect(parseBrowserControlRequest({ action: "takeover", userId: "foreign" })).toBeNull();
    expect(parseBrowserGatewayTokenRequest({
      capabilities: ["control", "view"],
      ttlMs: 30_000,
    })).toEqual({ capabilities: ["control", "view"], ttlMs: 30_000 });
    expect(parseBrowserGatewayTokenRequest({ capabilities: ["view", "view"] })).toBeNull();
  });

  it("normalizes navigation and bounds viewer input", () => {
    expect(parseBrowserViewerCommand({ action: "navigate", url: "https://example.test/path" }))
      .toEqual({ action: "navigate", url: "https://example.test/path" });
    expect(parseBrowserViewerCommand({ action: "navigate", url: "file:///etc/passwd" })).toBeNull();
    expect(parseBrowserViewerCommand({
      action: "input",
      command: { kind: "mouse", event: "mousePressed", x: 12, y: 24, button: "left" },
    })).toEqual({
      action: "input",
      command: { kind: "mouse", event: "mousePressed", x: 12, y: 24, button: "left" },
    });
    expect(parseBrowserViewerCommand({
      action: "input",
      command: { kind: "key", event: "keyDown", key: "A", extra: true },
    })).toBeNull();
  });
});
