// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadAloudControl, VoiceDictationControl } from "@/components/voice-controls";

type RecognitionHandlers = {
  onstart: (() => void) | null;
  onresult: ((event: Event & { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
};

let recognition: RecognitionHandlers & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> };

class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: RecognitionHandlers["onstart"] = null;
  onresult: RecognitionHandlers["onresult"] = null;
  onerror: RecognitionHandlers["onerror"] = null;
  onend: RecognitionHandlers["onend"] = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => this.onend?.());
  constructor() { recognition = this; }
}

class FakeUtterance {
  lang = "";
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

const speak = vi.fn();
const cancelSpeech = vi.fn();

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: { speak, cancel: cancelSpeech, speaking: false },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "SpeechRecognition");
  Reflect.deleteProperty(window, "webkitSpeechRecognition");
  Reflect.deleteProperty(window, "speechSynthesis");
});

describe("VoiceDictationControl", () => {
  it("asks for explicit consent, inserts editable text, and never sends", async () => {
    const onChange = vi.fn();
    render(<VoiceDictationControl value="Informe:" disabled={false} onChange={onChange} />);

    fireEvent.click(await screen.findByRole("button", { name: "Dictar mensaje" }));
    expect(screen.getByRole("dialog", { name: "Permiso para dictar" })).toBeInTheDocument();
    expect(recognition).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Activar dictado" }));
    expect(localStorage.getItem("aibrain.voice.dictation-consent.v1")).toBe("accepted");
    expect(screen.getByRole("status")).toHaveTextContent("Escuchando");

    act(() => recognition.onresult?.(Object.assign(new Event("result"), {
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "ventas semanales" } }],
    })));
    expect(onChange).toHaveBeenLastCalledWith("Informe: ventas semanales");
    expect(screen.getByRole("button", { name: "Terminar dictado" })).toBeInTheDocument();
  });

  it("restores the original prompt when dictation is cancelled", async () => {
    localStorage.setItem("aibrain.voice.dictation-consent.v1", "accepted");
    const onChange = vi.fn();
    render(<VoiceDictationControl value="Texto anterior" disabled={false} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dictar mensaje" }));
    act(() => recognition.onresult?.(Object.assign(new Event("result"), {
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: "texto temporal" } }],
    })));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar dictado" }));
    expect(recognition.abort).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith("Texto anterior");
  });

  it("shows an honest text fallback when the browser has no recognition API", async () => {
    Reflect.deleteProperty(window, "SpeechRecognition");
    render(<VoiceDictationControl value="" disabled={false} onChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dictar mensaje" }));
    expect(screen.getByRole("dialog", { name: "Dictado no disponible" })).toHaveTextContent("no ofrece dictado");
    expect(screen.getByText(/no la simulamos/i)).toBeInTheDocument();
  });
});

describe("ReadAloudControl", () => {
  it("reads only on request, persists the speed, and can stop", async () => {
    render(<ReadAloudControl text="Resultado listo" />);
    expect(speak).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Leer en voz alta" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Velocidad de lectura" }), { target: { value: "1.25" } });
    fireEvent.click(screen.getByRole("menuitem", { name: "Reproducir" }));
    expect(localStorage.getItem("aibrain.voice.read-rate.v1")).toBe("1.25");
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0]?.[0]).toMatchObject({ text: "Resultado listo", lang: "es-ES", rate: 1.25 });
    fireEvent.click(screen.getByRole("button", { name: "Detener lectura" }));
    expect(cancelSpeech).toHaveBeenCalled();
  });
});
