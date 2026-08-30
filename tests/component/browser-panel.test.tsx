// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPanel } from "@/components/browser-panel";

const THREAD_ID = "0198b9f0-6631-7000-8000-000000000611";
const SESSION_ID = "0198b9f0-6631-7000-8000-000000000612";
const browser = vi.hoisted(() => ({
  control: vi.fn(),
  issue: vi.fn(),
  openStream: vi.fn(),
  readNavigation: vi.fn(),
  readStatus: vi.fn(),
  send: vi.fn(),
  consume: vi.fn(),
}));

const readyStatus = {
  available: true,
  capabilityCode: null,
  healthy: true,
  state: {
    browserSessionId: SESSION_ID,
    lifecycle: "ready" as const,
    controller: "agent" as const,
    generation: 1,
    heartbeatExpiresAt: null,
    downloads: [],
  },
  runtime: { healthy: true },
  runningInProcess: true,
};

vi.mock("@/ui/browser-ui-adapter", () => ({
  controlBrowser: browser.control,
  issueBrowserViewerToken: browser.issue,
  openBrowserFrameStream: browser.openStream,
  readBrowserNavigationState: browser.readNavigation,
  readBrowserStatus: browser.readStatus,
  sendBrowserViewerCommand: browser.send,
}));
vi.mock("@/ui/browser-frame-stream", () => ({ consumeBrowserFrameStream: browser.consume }));

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:browser-frame");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  browser.readStatus.mockReset().mockResolvedValue(readyStatus);
  browser.control.mockReset().mockImplementation(async (action: string) => action === "takeover"
    ? { ...readyStatus, state: { ...readyStatus.state, lifecycle: "human-control", controller: "human" } }
    : readyStatus);
  browser.issue.mockReset().mockResolvedValue({ token: "private-viewer-token", browserSessionId: SESSION_ID });
  browser.openStream.mockReset().mockResolvedValue(new Response("stream"));
  browser.readNavigation.mockReset().mockResolvedValue({
    url: "https://example.test/current", canGoBack: true, canGoForward: false,
  });
  browser.send.mockReset().mockResolvedValue(null);
  browser.consume.mockReset().mockImplementation(async (_response, onRecord: (record: unknown) => Promise<void>) => {
    await onRecord({
      metadata: {
        version: 1, kind: "frame", sequence: 1,
        capturedAt: new Date().toISOString(), captureDurationMs: 20, mediaType: "image/png",
      },
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await new Promise<void>(() => undefined);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowserPanel", () => {
  it("uses a minimal browser header and keeps the rest for the direct viewport", async () => {
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    expect(screen.getByRole("button", { name: "Atrás" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adelante" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pantalla completa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar navegador" })).toBeInTheDocument();
    expect(screen.queryByText("Actividad reciente")).not.toBeInTheDocument();
    expect(screen.queryByText(/Chrome \d/)).not.toBeInTheDocument();
    expect(screen.queryByText("Tomar control")).not.toBeInTheDocument();
    expect(screen.queryByText("Detener")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByAltText("Vista actual del navegador privado")).toBeInTheDocument());
  });

  it("takes control on the first click, never replays it, and closes without stopping the session", async () => {
    const onClose = vi.fn();
    const view = render(<BrowserPanel threadId={THREAD_ID} open onClose={onClose} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    Object.defineProperty(image, "naturalWidth", { value: 1440 });
    Object.defineProperty(image, "naturalHeight", { value: 900 });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 450, width: 720, height: 450,
      toJSON: () => ({}),
    });
    fireEvent.click(image, { clientX: 360, clientY: 225 });
    await waitFor(() => expect(browser.control).toHaveBeenCalledWith("takeover"));
    await waitFor(() => expect(browser.send).toHaveBeenCalledTimes(2));
    expect(browser.send.mock.calls.map((call) => call[2].command.event)).toEqual(["mousePressed", "mouseReleased"]);

    fireEvent.click(screen.getByRole("button", { name: "Pantalla completa" }));
    expect(screen.getByRole("button", { name: "Salir de pantalla completa" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salir de pantalla completa" }));

    fireEvent.click(screen.getByRole("button", { name: "Cerrar navegador" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(browser.control).toHaveBeenCalledWith("release");
    expect(browser.control).not.toHaveBeenCalledWith("stop");
    view.rerender(<BrowserPanel threadId={THREAD_ID} open={false} onClose={onClose} initialStatus={readyStatus} />);
    view.rerender(<BrowserPanel threadId={THREAD_ID} open onClose={onClose} initialStatus={readyStatus} />);
    await waitFor(() => expect(browser.issue.mock.calls.length).toBeGreaterThan(1));
    expect(browser.issue.mock.calls.every((call) => call[0] === THREAD_ID)).toBe(true);
    expect(browser.control).not.toHaveBeenCalledWith("start");
    expect(browser.control).not.toHaveBeenCalledWith("stop");
  });

  it("reattaches after a clean stream EOF without replaying browser input", async () => {
    browser.consume.mockReset()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(async () => new Promise<void>(() => undefined));
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    await waitFor(() => expect(browser.openStream.mock.calls.length).toBeGreaterThan(1));
    expect(browser.issue.mock.calls.length).toBeGreaterThan(1);
    expect(browser.send).not.toHaveBeenCalled();
  });
});
