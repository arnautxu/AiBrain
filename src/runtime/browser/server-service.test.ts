import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BrowserServiceError,
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
});
