import { describe, expect, it, vi } from "vitest";
import { TurnTerminalWatchdog } from "@/runtime/turn-terminal-watchdog";

describe("TurnTerminalWatchdog", () => {
  it("resets only the idle deadline when App Server makes progress", async () => {
    vi.useFakeTimers();
    try {
      const watchdog = new TurnTerminalWatchdog(100, 250);
      watchdog.start();
      await vi.advanceTimersByTimeAsync(80);
      watchdog.touch();
      await vi.advanceTimersByTimeAsync(80);
      let settled = false;
      void watchdog.timedOut.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(20);
      await expect(watchdog.timedOut).resolves.toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains a hard deadline despite continuous progress", async () => {
    vi.useFakeTimers();
    try {
      const watchdog = new TurnTerminalWatchdog(100, 220);
      watchdog.start();
      await vi.advanceTimersByTimeAsync(80);
      watchdog.touch();
      await vi.advanceTimersByTimeAsync(80);
      watchdog.touch();
      await vi.advanceTimersByTimeAsync(60);
      await expect(watchdog.timedOut).resolves.toBe("hard");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not expire while durable user input or approval is pending", async () => {
    vi.useFakeTimers();
    try {
      const watchdog = new TurnTerminalWatchdog(100, 200);
      watchdog.start();
      await vi.advanceTimersByTimeAsync(80);
      watchdog.pause();
      await vi.advanceTimersByTimeAsync(500);
      let settled = false;
      void watchdog.timedOut.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      watchdog.resume();
      await vi.advanceTimersByTimeAsync(100);
      await expect(watchdog.timedOut).resolves.toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});
