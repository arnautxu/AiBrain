import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BrowserServiceError,
  streamBrowserFrameEvents,
  viewerOperationRequiresProcessRecovery,
} from "@/runtime/browser/server-service";

describe("browser viewer recovery boundary", () => {
  it("treats a detached viewer as a safe stream replacement", () => {
    const cancellation = new BrowserServiceError(
      "BROWSER_OPERATION_CANCELLED",
      "Browser operation cancelled.",
      499,
    );

    expect(viewerOperationRequiresProcessRecovery(cancellation, false)).toBe(false);
    expect(viewerOperationRequiresProcessRecovery(cancellation, true)).toBe(true);
  });

  it("still fences the browser process after a real operation timeout", () => {
    const timeout = new BrowserServiceError(
      "BROWSER_OPERATION_TIMEOUT",
      "Browser operation timed out.",
      504,
    );

    expect(viewerOperationRequiresProcessRecovery(timeout, false)).toBe(true);
  });

  it("keeps an idle viewer alive past the heartbeat threshold without parallel captures", async () => {
    const controller = new AbortController();
    let captures = 0;
    let activeCaptures = 0;
    let maximumActiveCaptures = 0;
    const staticFrame = {
      schemaVersion: 1 as const,
      mediaType: "image/png" as const,
      dataBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
      capturedAt: new Date().toISOString(),
    };
    const events = streamBrowserFrameEvents({
      signal: controller.signal,
      capture: async () => {
        captures += 1;
        activeCaptures += 1;
        maximumActiveCaptures = Math.max(maximumActiveCaptures, activeCaptures);
        await new Promise((resolve) => setTimeout(resolve, 8));
        activeCaptures -= 1;
        return staticFrame;
      },
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds))),
      burstActive: () => false,
      now: Date.now,
      frameIntervalMs: 1,
      idleFrameIntervalMs: 1,
      heartbeatIntervalMs: 5,
      maximumDurationMs: 40,
    });
    const received = [];
    for await (const event of events) received.push(event);

    expect(received.filter(({ kind }) => kind === "frame")).toHaveLength(1);
    expect(received.filter(({ kind }) => kind === "heartbeat").length).toBeGreaterThanOrEqual(3);
    expect(received.filter(({ kind }) => kind === "heartbeat")
      .every(({ captureDurationMs, data }) => captureDurationMs === 0 && data.byteLength === 0)).toBe(true);
    expect(captures).toBeGreaterThanOrEqual(2);
    expect(maximumActiveCaptures).toBe(1);
  });
});
