// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPanel } from "@/components/browser-panel";
import { BROWSER_RUNTIME_CAPABILITIES } from "@/runtime/browser/capabilities";

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

function matchMediaStub(matches: boolean) {
  return vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

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
  class MockPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  vi.stubGlobal("PointerEvent", MockPointerEvent);
  vi.stubGlobal("matchMedia", matchMediaStub(false));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:browser-frame");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  browser.readStatus.mockReset().mockResolvedValue(readyStatus);
  browser.control.mockReset().mockImplementation(async (action: string) => action === "takeover"
    ? { ...readyStatus, state: { ...readyStatus.state, lifecycle: "human-control", controller: "human" } }
    : readyStatus);
  browser.issue.mockReset().mockImplementation(async () => ({ token: "private-viewer-token", browserSessionId: SESSION_ID }));
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
        pointerTrail: [{ id: "agent-click-1", x: 25, y: 40 }],
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
  it("renders the exact viewer controls announced to the runtime", async () => {
    const view = render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    await screen.findByAltText("Vista actual del navegador privado");
    const rendered = [...view.container.querySelectorAll<HTMLElement>("[data-browser-capability]")]
      .map((element) => element.dataset.browserCapability);
    expect(rendered.sort()).toEqual([...BROWSER_RUNTIME_CAPABILITIES.viewerControls].sort());
  });

  it("keeps rapid click, exact typing, paste and scroll ordered while takeover is pending", async () => {
    let takeOver!: (value: unknown) => void;
    browser.control.mockImplementation((action: string) => action === "takeover"
      ? new Promise((resolve) => { takeOver = resolve; })
      : Promise.resolve(readyStatus));
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    Object.defineProperties(image, {
      naturalWidth: { value: 1440 }, naturalHeight: { value: 900 },
      setPointerCapture: { value: vi.fn() }, releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
    });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 450, width: 720, height: 450,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(image, { pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(image, { pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 20 });
    fireEvent.keyDown(image, { key: "H", code: "KeyH", shiftKey: true });
    fireEvent.keyDown(image, { key: "i", code: "KeyI" });
    fireEvent.paste(image, { clipboardData: { getData: () => " català 👋" } });
    fireEvent.wheel(image, { clientX: 10, clientY: 20, deltaY: 137 });
    await waitFor(() => expect(browser.control).toHaveBeenCalledTimes(1));
    expect(browser.send).not.toHaveBeenCalled();
    await act(async () => takeOver({ ...readyStatus, state: { ...readyStatus.state, lifecycle: "human-control", controller: "human" } }));
    await waitFor(() => expect(browser.send).toHaveBeenCalledTimes(6));
    const commands = browser.send.mock.calls.flatMap((call) => call[2].commands ?? [call[2].command]);
    expect(commands.map((command) => command.event)).toEqual([
      "mousePressed", "mouseReleased", "keyDown", "keyUp", "keyDown", "keyUp", "char", "mouseWheel",
    ]);
    expect(commands.filter((command) => command.text).map((command) => command.text).join("")).toBe("Hi català 👋");
    expect(commands[7].deltaY).toBe(137);
    expect(image).toHaveFocus();
  });

  it("routes keyboard input to the remote page after the address bar navigates and the viewport is clicked", async () => {
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    const address = screen.getByRole("textbox", { name: "Dirección web" });
    Object.defineProperties(image, {
      naturalWidth: { value: 1440 }, naturalHeight: { value: 900 },
      setPointerCapture: { value: vi.fn() }, releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
    });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 450, width: 720, height: 450,
      toJSON: () => ({}),
    });
    // Reproduce the production failure: browser automation can dispatch the
    // viewport pointer sequence while native DOM focus remains in the URL bar.
    vi.spyOn(image, "focus").mockImplementation(() => undefined);
    address.focus();
    fireEvent.change(address, { target: { value: "https://www.wikipedia.org/" } });
    fireEvent.submit(address.closest("form")!);
    await waitFor(() => expect(browser.send).toHaveBeenCalledWith(
      THREAD_ID, expect.any(String), expect.objectContaining({ action: "navigate" }),
    ));

    fireEvent.pointerDown(image, { pointerId: 31, isPrimary: true, button: 0, clientX: 120, clientY: 90 });
    fireEvent.pointerUp(image, { pointerId: 31, isPrimary: true, button: 0, clientX: 120, clientY: 90 });
    expect(address).toHaveFocus();
    const acceptedLocally = fireEvent.keyDown(address, { key: "O", code: "KeyO", shiftKey: true });

    expect(acceptedLocally).toBe(false);
    await waitFor(() => {
      const commands = browser.send.mock.calls.flatMap((call) => call[2].commands ?? [call[2].command]);
      expect(commands.filter(Boolean).map((command) => command.event)).toContain("keyDown");
    });
    expect(address).toHaveValue("https://www.wikipedia.org/");

    const sendsBeforeFocusRelease = browser.send.mock.calls.length;
    fireEvent.pointerDown(address, { pointerId: 32, isPrimary: true, button: 0 });
    const acceptedAfterFocusRelease = fireEvent.keyDown(address, { key: "L", code: "KeyL" });
    expect(acceptedAfterFocusRelease).toBe(true);
    expect(browser.send).toHaveBeenCalledTimes(sendsBeforeFocusRelease);
  });

  it("does not send queued input into either thread after switching during takeover", async () => {
    let takeOver!: (value: unknown) => void;
    browser.control.mockImplementation((action: string) => action === "takeover"
      ? new Promise((resolve) => { takeOver = resolve; })
      : Promise.resolve(readyStatus));
    const view = render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    fireEvent.keyDown(image, { key: "a", code: "KeyA" });
    fireEvent.keyDown(image, { key: "b", code: "KeyB" });
    await waitFor(() => expect(browser.control).toHaveBeenCalledTimes(1));
    const otherThread = "0198b9f0-6631-7000-8000-000000000613";
    view.rerender(<BrowserPanel threadId={otherThread} open onClose={vi.fn()} initialStatus={readyStatus} />);
    expect(screen.queryByAltText("Vista actual del navegador privado")).not.toBeInTheDocument();
    await act(async () => takeOver({ ...readyStatus, state: { ...readyStatus.state, lifecycle: "human-control", controller: "human" } }));
    await screen.findByAltText("Vista actual del navegador privado");
    expect(browser.send).not.toHaveBeenCalled();
    expect(browser.issue.mock.calls.at(-1)?.[0]).toBe(otherThread);
    expect(browser.control).toHaveBeenCalledWith("release", undefined, browser.control.mock.calls[0][2]);
  });

  it("never retries an uncertain input or dispatches the dependent queued text", async () => {
    let rejectInput!: (reason: Error) => void;
    browser.send.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectInput = reject; }));
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    fireEvent.keyDown(image, { key: "a", code: "KeyA" });
    fireEvent.keyDown(image, { key: "b", code: "KeyB" });
    await waitFor(() => expect(browser.send).toHaveBeenCalledTimes(1));
    await act(async () => rejectInput(new Error("Resultado indeterminado")));
    expect(browser.send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/Revisa la página|indeterminado/);
  });

  it("renews aged control tokens before new input without replaying mutations", async () => {
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    fireEvent.keyDown(image, { key: "a", code: "KeyA" });
    await waitFor(() => expect(browser.send).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const issued = browser.issue.mock.calls.length;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 26_000);
    fireEvent.keyDown(image, { key: "b", code: "KeyB" });
    await waitFor(() => expect(browser.send).toHaveBeenCalledTimes(2));
    expect(browser.issue.mock.calls.length).toBeGreaterThan(issued);
  });

  it("does not carry pending text across a rotated browser session", async () => {
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    browser.issue.mockResolvedValue({ token: "rotated-token", browserSessionId: "0198b9f0-6631-7000-8000-000000000614" });
    fireEvent.keyDown(image, { key: "a", code: "KeyA" });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("La sesión ha cambiado"));
    expect(browser.send).not.toHaveBeenCalled();
  });

  it("keeps shortcuts out of text and routes local paste exactly once", async () => {
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    fireEvent.keyDown(image, { key: "a", code: "KeyA", ctrlKey: true });
    fireEvent.keyDown(image, { key: "v", code: "KeyV", ctrlKey: true });
    fireEvent.paste(image, { clipboardData: { getData: () => "exact paste" } });
    await waitFor(() => expect(browser.send).toHaveBeenCalledTimes(2));
    const commands = browser.send.mock.calls.flatMap((call) => call[2].commands ?? [call[2].command]);
    expect(commands.map((command) => command.event)).toEqual(["keyDown", "keyUp", "char"]);
    expect(commands[0]).toMatchObject({ key: "a", modifiers: 2 });
    expect(commands[0].text).toBeUndefined();
    expect(commands[2].text).toBe("exact paste");
  });

  it("uses a minimal browser header and keeps the rest for the direct viewport", async () => {
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    expect(screen.getByText("Navegador")).toBeInTheDocument();
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
    expect(document.querySelector('[data-slot="computer-use"]')).toBeInTheDocument();
    const trail = document.querySelector('[data-slot="computer-use-trail"]');
    expect(trail).toBeInTheDocument();
    expect(trail?.querySelector("svg")).toHaveStyle({ left: "25%", top: "40%" });
  });

  it("does not announce a live viewer before the first real frame finishes loading", async () => {
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    expect(screen.getByRole("status", { name: "Conectando" })).toBeInTheDocument();

    fireEvent.load(image);

    expect(screen.queryByRole("status", { name: "Conectando" })).not.toBeInTheDocument();
    expect(screen.getByRole("status").getAttribute("aria-label")).toMatch(/FPS|Conectado/u);
  });

  it("tracks locally at pointer speed while preserving remote press, held move, and release order", async () => {
    const onClose = vi.fn();
    const view = render(<BrowserPanel threadId={THREAD_ID} open onClose={onClose} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    Object.defineProperty(image, "naturalWidth", { value: 1440 });
    Object.defineProperty(image, "naturalHeight", { value: 900 });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 450, width: 720, height: 450,
      toJSON: () => ({}),
    });
    const captured = new Set<number>();
    const setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId));
    const releasePointerCapture = vi.fn((pointerId: number) => captured.delete(pointerId));
    Object.defineProperties(image, {
      setPointerCapture: { value: setPointerCapture },
      releasePointerCapture: { value: releasePointerCapture },
      hasPointerCapture: { value: (pointerId: number) => captured.has(pointerId) },
    });

    fireEvent.pointerDown(image, { pointerId: 7, isPrimary: true, button: 0, clientX: 360, clientY: 225 });
    const cursor = document.querySelector('[data-slot="computer-use-cursor"]');
    expect(cursor).toHaveAttribute("data-pressed", "true");
    expect(cursor).toHaveStyle({ transform: "translate3d(360px, 225px, 0) scale(0.9)" });
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    fireEvent.pointerMove(image, { pointerId: 7, isPrimary: true, buttons: 1, clientX: 480, clientY: 270 });
    fireEvent.pointerMove(image, { pointerId: 7, isPrimary: true, buttons: 1, clientX: 500, clientY: 280 });
    expect(cursor).toHaveStyle({ transform: "translate3d(500px, 280px, 0) scale(0.9)" });
    fireEvent.pointerUp(image, { pointerId: 7, isPrimary: true, button: 0, clientX: 540, clientY: 315 });
    expect(cursor).toHaveAttribute("data-pressed", "false");
    expect(cursor).toHaveStyle({ transform: "translate3d(540px, 315px, 0) scale(1)" });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);

    await waitFor(() => expect(browser.control).toHaveBeenCalledWith("takeover", undefined, expect.objectContaining({ browserSessionId: SESSION_ID })));
    await waitFor(() => expect(browser.send).toHaveBeenCalledTimes(3));
    expect(browser.send.mock.calls.map((call) => call[2].command.event)).toEqual([
      "mousePressed", "mouseMoved", "mouseReleased",
    ]);
    expect(browser.send.mock.calls.map((call) => call[2].command.button)).toEqual(["left", "left", "left"]);
    expect(browser.send.mock.calls.map((call) => call[2].command.buttons)).toEqual([1, 1, 0]);
    expect(browser.send.mock.calls.map((call) => [call[2].command.x, call[2].command.y])).toEqual([
      [720, 450], [960, 540], [1080, 630],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Pantalla completa" }));
    expect(screen.getByRole("button", { name: "Salir de pantalla completa" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salir de pantalla completa" }));

    fireEvent.click(screen.getByRole("button", { name: "Cerrar navegador" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(browser.control).toHaveBeenCalledWith("release", undefined,
      expect.objectContaining({ browserSessionId: SESSION_ID }));
    expect(browser.control).not.toHaveBeenCalledWith("stop");
    view.rerender(<BrowserPanel threadId={THREAD_ID} open={false} onClose={onClose} initialStatus={readyStatus} />);
    view.rerender(<BrowserPanel threadId={THREAD_ID} open onClose={onClose} initialStatus={readyStatus} />);
    await waitFor(() => expect(browser.issue.mock.calls.length).toBeGreaterThan(1));
    expect(browser.issue.mock.calls.every((call) => call[0] === THREAD_ID)).toBe(true);
    expect(browser.control).not.toHaveBeenCalledWith("start");
    expect(browser.control).not.toHaveBeenCalledWith("stop");
  });

  it("safely releases a held remote button once when pointer capture is cancelled", async () => {
    const onClose = vi.fn();
    render(<BrowserPanel threadId={THREAD_ID} open onClose={onClose} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    Object.defineProperty(image, "naturalWidth", { value: 1440 });
    Object.defineProperty(image, "naturalHeight", { value: 900 });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 450, width: 720, height: 450,
      toJSON: () => ({}),
    });
    const captured = new Set<number>();
    Object.defineProperties(image, {
      setPointerCapture: { value: (pointerId: number) => captured.add(pointerId) },
      releasePointerCapture: { value: (pointerId: number) => captured.delete(pointerId) },
      hasPointerCapture: { value: (pointerId: number) => captured.has(pointerId) },
    });

    fireEvent.pointerDown(image, { pointerId: 9, isPrimary: true, button: 0, clientX: 120, clientY: 90 });
    fireEvent.pointerCancel(image, { pointerId: 9, isPrimary: true, clientX: 180, clientY: 120 });
    fireEvent.lostPointerCapture(image, { pointerId: 9, isPrimary: true });

    await waitFor(() => expect(browser.send).toHaveBeenCalledTimes(2));
    expect(browser.send.mock.calls.map((call) => call[2].command.event)).toEqual(["mousePressed", "mouseReleased"]);
    expect(document.querySelector('[data-slot="computer-use-cursor"]')).toHaveAttribute("data-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar navegador" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(browser.send).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(browser.control).toHaveBeenCalledWith("release", undefined, expect.objectContaining({ browserSessionId: SESSION_ID })));
  });

  it("cancels a held pointer before its queued press dispatches on close", async () => {
    const onClose = vi.fn();
    render(<BrowserPanel threadId={THREAD_ID} open onClose={onClose} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    Object.defineProperty(image, "naturalWidth", { value: 1440 });
    Object.defineProperty(image, "naturalHeight", { value: 900 });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 450, width: 720, height: 450,
      toJSON: () => ({}),
    });
    Object.defineProperties(image, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
    });

    fireEvent.pointerDown(image, { pointerId: 11, isPrimary: true, button: 0, clientX: 240, clientY: 180 });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar navegador" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(browser.send).not.toHaveBeenCalled();
    expect(browser.control).not.toHaveBeenCalledWith("takeover", undefined,
      expect.objectContaining({ browserSessionId: SESSION_ID }));
  });

  it("releases control after a takeover that resolves during unmount", async () => {
    let resolveTakeover!: (value: unknown) => void;
    const humanStatus = {
      ...readyStatus,
      state: { ...readyStatus.state, lifecycle: "human-control" as const, controller: "human" as const },
    };
    browser.control.mockImplementation((action: string) => {
      if (action === "takeover") {
        return new Promise((resolve) => { resolveTakeover = resolve; });
      }
      return Promise.resolve(readyStatus);
    });

    const view = render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    Object.defineProperty(image, "naturalWidth", { value: 1440 });
    Object.defineProperty(image, "naturalHeight", { value: 900 });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 450, width: 720, height: 450,
      toJSON: () => ({}),
    });
    Object.defineProperties(image, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
    });

    fireEvent.pointerDown(image, { pointerId: 13, isPrimary: true, button: 0, clientX: 240, clientY: 180 });
    await waitFor(() => expect(browser.control).toHaveBeenCalledWith("takeover", undefined, expect.objectContaining({ browserSessionId: SESSION_ID })));
    view.unmount();
    expect(browser.control).not.toHaveBeenCalledWith("release", undefined, expect.objectContaining({ browserSessionId: SESSION_ID }));

    await act(async () => { resolveTakeover(humanStatus); });

    await waitFor(() => expect(browser.control).toHaveBeenCalledWith("release", undefined, expect.objectContaining({ browserSessionId: SESSION_ID })));
    expect(browser.send).not.toHaveBeenCalled();
    expect(browser.control).toHaveBeenCalledWith("release", undefined, browser.control.mock.calls[0][2]);
  });

  it("closes immediately and cancels pending pointer input while scoped takeover releases in the background", async () => {
    vi.stubGlobal("matchMedia", matchMediaStub(true));
    let resolveTakeover!: (value: unknown) => void;
    const humanStatus = {
      ...readyStatus,
      state: { ...readyStatus.state, lifecycle: "human-control" as const, controller: "human" as const },
    };
    browser.control.mockImplementation((action: string) => {
      if (action === "takeover") {
        return new Promise((resolve) => { resolveTakeover = resolve; });
      }
      return Promise.resolve(readyStatus);
    });
    let view: ReturnType<typeof render>;
    const onClose = vi.fn(() => {
      view.rerender(<BrowserPanel threadId={THREAD_ID} open={false} onClose={onClose} initialStatus={readyStatus} />);
    });
    view = render(<BrowserPanel threadId={THREAD_ID} open onClose={onClose} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    Object.defineProperty(image, "naturalWidth", { value: 1440 });
    Object.defineProperty(image, "naturalHeight", { value: 900 });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 450, width: 720, height: 450,
      toJSON: () => ({}),
    });
    Object.defineProperties(image, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
    });

    fireEvent.pointerDown(image, { pointerId: 17, isPrimary: true, button: 0, clientX: 240, clientY: 180 });
    await waitFor(() => expect(browser.control).toHaveBeenCalledWith("takeover", undefined, expect.objectContaining({ browserSessionId: SESSION_ID })));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar navegador" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-side-window="browser"]')).toHaveAttribute("aria-hidden", "true");
    expect(browser.control).not.toHaveBeenCalledWith("release", undefined, expect.objectContaining({ browserSessionId: SESSION_ID }));

    await act(async () => { resolveTakeover(humanStatus); });

    await waitFor(() => expect(browser.control).toHaveBeenCalledWith("release", undefined, expect.objectContaining({ browserSessionId: SESSION_ID })));
    expect(browser.send).not.toHaveBeenCalled();
    expect(browser.control).toHaveBeenCalledWith("release", undefined, browser.control.mock.calls[0][2]);
  });

  it("acts as a compact modal, traps focus, closes with Escape, and returns focus", async () => {
    vi.stubGlobal("matchMedia", matchMediaStub(true));
    const opener = document.createElement("button");
    opener.textContent = "Abrir navegador";
    document.body.append(opener);
    opener.focus();

    let view: ReturnType<typeof render>;
    const onClose = vi.fn(() => {
      view.rerender(<BrowserPanel threadId={THREAD_ID} open={false} onClose={onClose} initialStatus={readyStatus} />);
    });
    view = render(<BrowserPanel threadId={THREAD_ID} open onClose={onClose} initialStatus={readyStatus} />);

    const dialog = await screen.findByRole("dialog", { name: "Navegador" });
    const close = screen.getByRole("button", { name: "Cerrar navegador" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.tabIndex >= 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();

    last!.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
    first!.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await waitFor(() => expect(opener).toHaveFocus());
    // Closing retires the attachment rather than retaining its DOM and tokens.
    expect(dialog).not.toBeInTheDocument();
    const closedPanel = document.querySelector('[data-side-window="browser"]');
    expect(closedPanel).toHaveAttribute("aria-hidden", "true");
    expect(closedPanel).toHaveAttribute("inert");
    opener.remove();
  });

  it("reattaches after a clean stream EOF without replaying browser input", async () => {
    browser.consume.mockReset()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(async () => new Promise<void>(() => undefined));
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    await waitFor(() => expect(browser.openStream).toHaveBeenCalledTimes(2));
    expect(browser.issue.mock.calls.length).toBeGreaterThan(1);
    expect(browser.send).not.toHaveBeenCalled();
  });
  it("combines a waiting wheel burst without moving it past a keyboard barrier", async () => {
    let takeOver!: (value: unknown) => void;
    browser.control.mockImplementation((action: string) => action === "takeover"
      ? new Promise((resolve) => { takeOver = resolve; }) : Promise.resolve(readyStatus));
    render(<BrowserPanel threadId={THREAD_ID} open onClose={vi.fn()} initialStatus={readyStatus} />);
    const image = await screen.findByAltText("Vista actual del navegador privado");
    Object.defineProperties(image, { naturalWidth: { value: 1440 }, naturalHeight: { value: 900 } });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 720, height: 450 } as DOMRect);
    for (let index = 0; index < 80; index += 1) fireEvent.wheel(image, { clientX: 10, clientY: 20, deltaY: 3 });
    fireEvent.keyDown(image, { key: "a", code: "KeyA" });
    fireEvent.wheel(image, { clientX: 10, clientY: 20, deltaY: 7, deltaMode: 1 });
    await waitFor(() => expect(browser.control).toHaveBeenCalledTimes(1));
    await act(async () => takeOver({ ...readyStatus, state: { ...readyStatus.state, lifecycle: "human-control", controller: "human" } }));
    await waitFor(() => expect(browser.send).toHaveBeenCalledTimes(3));
    const commands = browser.send.mock.calls.flatMap((call) => call[2].commands ?? [call[2].command]);
    expect(commands.map((command) => command.event)).toEqual(["mouseWheel", "keyDown", "keyUp", "mouseWheel"]);
    expect(commands.filter((command) => command.event === "mouseWheel").map((command) => command.deltaY)).toEqual([240, 112]);
  });

});
