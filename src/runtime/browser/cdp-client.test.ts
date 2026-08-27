import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  PrivateCdpClient,
  type PrivateCdpMethod,
} from "@/runtime/browser/cdp-client";

type PipeHarness = {
  request: PassThrough;
  response: PassThrough;
  client: PrivateCdpClient;
  commands: Array<Record<string, unknown>>;
};

function pipeHarness(options: Parameters<typeof PrivateCdpClient.connect>[2] = {}): PipeHarness {
  const request = new PassThrough();
  const response = new PassThrough();
  const commands: Array<Record<string, unknown>> = [];
  let buffered = Buffer.alloc(0);
  request.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      const separator = buffered.indexOf(0);
      if (separator === -1) break;
      commands.push(JSON.parse(buffered.subarray(0, separator).toString("utf8")) as Record<string, unknown>);
      buffered = buffered.subarray(separator + 1);
    }
  });
  return {
    request,
    response,
    client: PrivateCdpClient.connect(request, response, options),
    commands,
  };
}

function frame(value: unknown) {
  return Buffer.from(`${JSON.stringify(value)}\u0000`, "utf8");
}

async function eventually(check: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition did not become true");
}

describe("PrivateCdpClient pipe transport", () => {
  it("frames fragmented responses and routes concurrent flat sessions without crossing events", async () => {
    const harness = pipeHarness();
    const eventA: unknown[] = [];
    const eventB: unknown[] = [];
    const rootEvents: unknown[] = [];
    harness.client.on("Fetch.requestPaused", (value) => eventA.push(value), { sessionId: "session-a" });
    harness.client.on("Fetch.requestPaused", (value) => eventB.push(value), { sessionId: "session-b" });
    harness.client.on("Target.attachedToTarget", (value) => rootEvents.push(value));

    const commandA = harness.client.send<{ value: string }>("Page.enable", {}, { sessionId: "session-a" });
    const commandB = harness.client.send<{ value: string }>("Network.enable", {}, { sessionId: "session-b" });
    await eventually(() => harness.commands.length === 2);
    expect(harness.commands).toEqual([
      expect.objectContaining({ id: 1, method: "Page.enable", sessionId: "session-a" }),
      expect.objectContaining({ id: 2, method: "Network.enable", sessionId: "session-b" }),
    ]);

    const combined = Buffer.concat([
      frame({ id: 2, sessionId: "session-b", result: { value: "B" } }),
      frame({ method: "Fetch.requestPaused", sessionId: "session-a", params: { requestId: "a" } }),
      frame({ method: "Fetch.requestPaused", sessionId: "session-b", params: { requestId: "b" } }),
      frame({ method: "Target.attachedToTarget", params: { sessionId: "session-a" } }),
      frame({ id: 1, sessionId: "session-a", result: { value: "A" } }),
    ]);
    harness.response.write(combined.subarray(0, 7));
    harness.response.write(combined.subarray(7, combined.length - 3));
    harness.response.write(combined.subarray(combined.length - 3));

    await expect(commandA).resolves.toEqual({ value: "A" });
    await expect(commandB).resolves.toEqual({ value: "B" });
    expect(eventA).toEqual([{ requestId: "a" }]);
    expect(eventB).toEqual([{ requestId: "b" }]);
    expect(rootEvents).toEqual([{ sessionId: "session-a" }]);
    await harness.client.close();
  });

  it("enforces allowlists, command size, pending backpressure and timeouts", async () => {
    const harness = pipeHarness({
      commandTimeoutMs: 30,
      maxPendingCommands: 1,
      maxCommandBytes: 128,
    });
    const pending = harness.client.send("Browser.getVersion");
    await expect(harness.client.send("Page.enable"))
      .rejects.toMatchObject({ code: "CDP_BACKPRESSURE" });
    await expect(harness.client.send("Runtime.evaluate" as PrivateCdpMethod))
      .rejects.toMatchObject({ code: "CDP_METHOD_REJECTED" });
    await expect(pending).rejects.toMatchObject({ code: "CDP_COMMAND_TIMEOUT" });
    await expect(harness.client.send("Page.navigate", { url: "https://example.test/".repeat(20) }))
      .rejects.toMatchObject({ code: "CDP_COMMAND_TOO_LARGE" });
    await harness.client.close();
  });

  it("fails closed on mismatched sessions, malformed UTF-8 JSON and oversized frames", async () => {
    const mismatched = pipeHarness();
    const pending = mismatched.client.send("Page.enable", {}, { sessionId: "session-a" });
    await eventually(() => mismatched.commands.length === 1);
    mismatched.response.write(frame({ id: 1, sessionId: "session-b", result: {} }));
    await expect(pending).rejects.toMatchObject({ code: "CDP_PROTOCOL_ERROR" });
    expect(mismatched.client.isOpen).toBe(false);

    const malformed = pipeHarness();
    const malformedPending = malformed.client.send("Browser.getVersion");
    malformed.response.write(Buffer.from([0xc3, 0x28, 0x00]));
    await expect(malformedPending).rejects.toMatchObject({ code: "CDP_PROTOCOL_ERROR" });
    expect(malformed.client.isOpen).toBe(false);

    const oversized = pipeHarness({ maxFrameBytes: 32 });
    const oversizedPending = oversized.client.send("Browser.getVersion");
    oversized.response.write(Buffer.alloc(33, 0x61));
    await expect(oversizedPending).rejects.toMatchObject({ code: "CDP_PROTOCOL_ERROR" });
    expect(oversized.client.isOpen).toBe(false);
  });

  it("rejects every pending command on EOF and incomplete terminal frames", async () => {
    const eof = pipeHarness();
    const first = eof.client.send("Browser.getVersion");
    const second = eof.client.send("Target.getTargets");
    eof.response.end();
    await expect(first).rejects.toMatchObject({ code: "CDP_PIPE_EOF" });
    await expect(second).rejects.toMatchObject({ code: "CDP_PIPE_EOF" });

    const incomplete = pipeHarness();
    const pending = incomplete.client.send("Browser.getVersion");
    incomplete.response.write("{\"id\":1");
    incomplete.response.end();
    await expect(pending).rejects.toMatchObject({ code: "CDP_PROTOCOL_ERROR" });
  });
});
