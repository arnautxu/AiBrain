import { describe, expect, it } from "vitest";
import { TurnTelemetry } from "@/runtime/turn-telemetry";

describe("turn telemetry", () => {
  it("records first server delta, cadence, reconnect and terminal error with a controlled clock", () => {
    let now = 1_000;
    const records: Array<{ event: string; attributes: Record<string, unknown> }> = [];
    const telemetry = new TurnTelemetry({
      installationId: "qa-company",
      userId: "00000000-0000-4000-8000-000000000001",
      projectId: "project-1",
      threadId: "thread-1",
      localTurnId: "turn-local-1",
      clientRequestId: "request-1",
      streamRequestId: "stream-1",
    }, {
      now: () => now,
      logger: { info: (event, attributes = {}) => records.push({ event, attributes: { ...attributes } }) },
    });

    telemetry.bindRuntimeThread("runtime-thread-1");
    telemetry.resumed();
    now = 1_005;
    telemetry.delta();
    now = 1_025;
    telemetry.delta();
    now = 1_060;
    telemetry.delta();
    now = 1_070;
    telemetry.disconnected();
    now = 1_080;
    telemetry.reconnected();
    now = 1_085;
    telemetry.cancellationRequested();
    now = 1_100;
    const metrics = telemetry.finish("error");

    expect(metrics).toEqual({
      serverFirstDeltaMs: 5,
      serverDeltaCount: 3,
      serverInterDeltaP50Ms: 20,
      serverInterDeltaP95Ms: 35,
      serverInterDeltaMaxMs: 35,
      totalMs: 100,
      resumeCount: 1,
      reconnectCount: 1,
      disconnectCount: 1,
      cancelRequested: true,
    });
    expect(records).toEqual([
      expect.objectContaining({ event: "codex.turn_lifecycle", attributes: expect.objectContaining({ lifecycle: "resumed", requestElapsedMs: 0 }) }),
      expect.objectContaining({ event: "codex.turn_lifecycle", attributes: expect.objectContaining({ lifecycle: "disconnected", requestElapsedMs: 70 }) }),
      expect.objectContaining({ event: "codex.turn_lifecycle", attributes: expect.objectContaining({ lifecycle: "reconnected", requestElapsedMs: 80 }) }),
      expect.objectContaining({ event: "codex.turn_lifecycle", attributes: expect.objectContaining({ lifecycle: "cancel_requested", requestElapsedMs: 85 }) }),
      expect.objectContaining({
        event: "codex.turn_metrics",
        attributes: expect.objectContaining({
          terminal: "error",
          localTurnId: "turn-local-1",
          clientRequestId: "request-1",
          streamRequestId: "stream-1",
          runtimeThreadId: "runtime-thread-1",
          serverFirstDeltaMs: 5,
          serverInterDeltaP95Ms: 35,
          totalMs: 100,
        }),
      }),
    ]);
    expect(JSON.stringify(records)).not.toMatch(/prompt|content|token|secret/iu);
  });
});
