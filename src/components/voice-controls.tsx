"use client";

import { Microphone, SpeakerHigh, Stop, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type RecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type RecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
};

type RecognitionErrorEventLike = Event & { error?: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type DictationState = "idle" | "listening" | "processing" | "error";

const DICTATION_CONSENT_KEY = "aibrain.voice.dictation-consent.v1";
const READ_RATE_KEY = "aibrain.voice.read-rate.v1";
const subscribeToNoEvents = () => () => undefined;

function recognitionConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function recognitionError(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "El navegador ha bloqueado el micrófono. Revisa su permiso y vuelve a intentarlo.";
  }
  if (error === "audio-capture") return "No se ha encontrado un micrófono disponible.";
  if (error === "no-speech") return "No se ha detectado voz. Puedes intentarlo de nuevo o escribir el mensaje.";
  if (error === "network") return "El servicio de voz del navegador no está disponible ahora mismo.";
  return "No se ha podido completar el dictado. El texto anterior sigue intacto.";
}

export function VoiceDictationControl({
  value,
  disabled,
  language = "es-ES",
  onChange,
  onNotice,
}: {
  value: string;
  disabled: boolean;
  language?: string;
  onChange: (value: string) => void;
  onNotice?: (message: string) => void;
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const startingValueRef = useRef("");
  const finalTranscriptRef = useRef("");
  const cancelledRef = useRef(false);
  const failedRef = useRef(false);
  const processingTimerRef = useRef<number | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      recognitionRef.current?.abort();
      if (processingTimerRef.current !== null) window.clearTimeout(processingTimerRef.current);
    };
  }, []);

  const finishProcessing = () => {
    setState("processing");
    if (processingTimerRef.current !== null) window.clearTimeout(processingTimerRef.current);
    processingTimerRef.current = window.setTimeout(() => {
      setState("idle");
      processingTimerRef.current = null;
      onNotice?.("Dictado añadido. Revísalo y edítalo antes de enviar.");
    }, 350);
  };

  const start = () => {
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setFallbackOpen(true);
      return;
    }

    setConsentOpen(false);
    setFallbackOpen(false);
    setError(null);
    cancelledRef.current = false;
    failedRef.current = false;
    startingValueRef.current = value;
    finalTranscriptRef.current = "";
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.onstart = () => setState("listening");
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? "";
        if (!transcript) continue;
        if (result.isFinal) finalTranscriptRef.current = `${finalTranscriptRef.current} ${transcript}`.trim();
        else interim = `${interim} ${transcript}`.trim();
      }
      const spoken = [finalTranscriptRef.current, interim].filter(Boolean).join(" ");
      const prefix = startingValueRef.current.trimEnd();
      onChange([prefix, spoken].filter(Boolean).join(prefix ? " " : ""));
    };
    recognition.onerror = (event) => {
      if (cancelledRef.current) return;
      const message = recognitionError(event.error);
      failedRef.current = true;
      setError(message);
      setState("error");
      onNotice?.(message);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (cancelledRef.current || failedRef.current) return;
      finishProcessing();
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      const message = "El micrófono ya está en uso o no ha podido iniciarse.";
      setError(message);
      setState("error");
      onNotice?.(message);
    }
  };

  const requestStart = () => {
    if (!recognitionConstructor()) {
      setFallbackOpen(true);
      return;
    }
    if (localStorage.getItem(DICTATION_CONSENT_KEY) !== "accepted") {
      setConsentOpen(true);
      return;
    }
    start();
  };

  const confirmConsent = () => {
    localStorage.setItem(DICTATION_CONSENT_KEY, "accepted");
    start();
  };

  const stop = () => {
    setState("processing");
    recognitionRef.current?.stop();
  };

  const cancel = () => {
    cancelledRef.current = true;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    onChange(startingValueRef.current);
    setState("idle");
    setError(null);
    onNotice?.("Dictado cancelado. No se ha enviado nada.");
  };

  const active = state === "listening" || state === "processing";
  return (
    <div className="relative shrink-0">
      {state === "listening" ? (
        <div className="flex items-center gap-1" role="group" aria-label="Dictado activo">
          <span className="hidden items-center gap-1 text-[10px] font-medium text-[var(--danger)] sm:flex" role="status">
            <span className="size-1.5 animate-pulse rounded-full bg-[var(--danger)] motion-reduce:animate-none" />Escuchando
          </span>
          <button type="button" className="composer-tool !grid !size-11 !place-items-center !rounded-xl text-[var(--danger)] sm:!rounded-full" aria-label="Terminar dictado" title="Terminar dictado" onClick={stop}><Stop size={12} weight="fill" /></button>
          <button type="button" className="composer-tool !grid !size-11 !place-items-center !rounded-xl sm:!rounded-full" aria-label="Cancelar dictado" title="Cancelar y descartar dictado" onClick={cancel}><X size={14} /></button>
        </div>
      ) : (
        <button
          type="button"
          className={`composer-tool !grid !size-11 !place-items-center !rounded-xl sm:!rounded-full ${state === "error" ? "text-[var(--danger)]" : ""}`}
          aria-label={state === "processing" ? "Procesando dictado" : "Dictar mensaje"}
          title={state === "processing" ? "Procesando dictado" : "Dictar mensaje"}
          aria-haspopup="dialog"
          aria-expanded={consentOpen || fallbackOpen}
          disabled={disabled || state === "processing"}
          onClick={requestStart}
        >
          <Microphone size={15} className={state === "processing" ? "motion-safe:animate-pulse" : ""} />
        </button>
      )}

      {consentOpen ? (
        <div role="dialog" aria-label="Permiso para dictar" className="menu-enter absolute bottom-full right-0 z-40 mb-2 w-[min(320px,calc(100vw-2rem))] rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-left shadow-[var(--shadow-popover)]">
          <p className="text-[12px] font-semibold text-[var(--text)]">Usar el micrófono para dictar</p>
          <p className="mt-1.5 text-[11px] leading-4 text-[var(--text-subtle)]">El navegador procesa tu voz con su propio servicio y añadirá el texto al mensaje. La aplicación no recibe audio ni lo guarda, y nunca enviará el mensaje automáticamente.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="min-h-10 rounded-full px-3 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]" onClick={() => setConsentOpen(false)}>Ahora no</button>
            <button type="button" className="min-h-10 rounded-full bg-[var(--brain-accent)] px-4 text-[11px] font-semibold text-[var(--brain-contrast)]" onClick={confirmConsent}>Activar dictado</button>
          </div>
        </div>
      ) : null}

      {fallbackOpen ? (
        <div role="dialog" aria-label="Dictado no disponible" className="menu-enter absolute bottom-full right-0 z-40 mb-2 w-[min(320px,calc(100vw-2rem))] rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-left shadow-[var(--shadow-popover)]">
          <p className="text-[12px] font-semibold text-[var(--text)]">Dictado no disponible</p>
          <p className="mt-1.5 text-[11px] leading-4 text-[var(--text-subtle)]">Este navegador no ofrece dictado. Escribe o pega el texto en el mensaje. Esta instalación tampoco publica una transcripción de archivos de audio, así que no la simulamos.</p>
          <button type="button" className="mt-3 min-h-10 w-full rounded-full border border-[var(--border)] text-[11px] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)]" onClick={() => setFallbackOpen(false)}>Entendido</button>
        </div>
      ) : null}

      {error && !active ? <span className="sr-only" role="alert">{error}</span> : null}
    </div>
  );
}

const READ_RATES = [0.75, 1, 1.25, 1.5] as const;

export function ReadAloudControl({ text, language = "es-ES" }: { text: string; language?: string }) {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [open, setOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const stored = Number(localStorage.getItem(READ_RATE_KEY));
    return READ_RATES.includes(stored as (typeof READ_RATES)[number]) ? stored : 1;
  });
  const supported = useSyncExternalStore(
    subscribeToNoEvents,
    () => typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined",
    () => false,
  );

  useEffect(() => {
    return () => {
      const utterance = utteranceRef.current;
      if (utterance) window.speechSynthesis?.cancel();
    };
  }, []);

  const stop = () => {
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeaking(false);
  };

  const read = () => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = rate;
    utterance.onend = () => { utteranceRef.current = null; setSpeaking(false); };
    utterance.onerror = () => { utteranceRef.current = null; setSpeaking(false); };
    utteranceRef.current = utterance;
    setSpeaking(true);
    setOpen(false);
    window.speechSynthesis.speak(utterance);
  };

  if (!supported) return null;
  return (
    <div className="relative">
      <button type="button" title={speaking ? "Detener lectura" : "Leer en voz alta"} aria-label={speaking ? "Detener lectura" : "Leer en voz alta"} aria-expanded={open} aria-haspopup="menu" className={`result-action ${speaking ? "text-[var(--brain-accent)]" : ""}`} onClick={() => speaking ? stop() : setOpen((current) => !current)}>{speaking ? <Stop size={13} weight="fill" /> : <SpeakerHigh size={14} />}</button>
      {open ? (
        <div role="menu" aria-label="Lectura en voz alta" className="menu-enter absolute bottom-full left-0 z-30 mb-2 w-56 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-popover)]">
          <p className="text-[11px] font-semibold text-[var(--text)]">Leer esta respuesta</p>
          <label className="mt-2 block text-[10px] text-[var(--text-subtle)]">Velocidad
            <select aria-label="Velocidad de lectura" className="mt-1 min-h-10 w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px] text-[var(--text)]" value={rate} onChange={(event) => { const next = Number(event.target.value); setRate(next); localStorage.setItem(READ_RATE_KEY, String(next)); }}>
              {READ_RATES.map((option) => <option key={option} value={option}>{option === 1 ? "Normal" : `${option}×`}</option>)}
            </select>
          </label>
          <p className="mt-2 text-[9px] leading-3 text-[var(--text-subtle)]">La voz se genera en tu navegador. La velocidad queda guardada solo en este dispositivo.</p>
          <button type="button" role="menuitem" className="mt-3 min-h-10 w-full rounded-full bg-[var(--brain-accent)] px-3 text-[11px] font-semibold text-[var(--brain-contrast)]" onClick={read}>Reproducir</button>
        </div>
      ) : null}
    </div>
  );
}
