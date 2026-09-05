"use client";

import { Bug, Lightbulb, Question, SpinnerGap, X } from "@phosphor-icons/react";
import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SupportKind } from "@/support/contracts";
import { useModalFocus } from "@/ui/use-modal-focus";

const choices: Array<{ id: SupportKind; label: string; icon: typeof Bug }> = [
  { id: "bug", label: "Bug", icon: Bug },
  { id: "request", label: "Request", icon: Lightbulb },
  { id: "help", label: "Ayuda", icon: Question },
];

export function SupportDialog({ open, projectId, threadId, returnFocusRef, onClose }: {
  open: boolean;
  projectId: string | null;
  threadId: string | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<SupportKind>("help");
  const [description, setDescription] = useState("");

  if (!open) return null;
  return <OpenSupportDialog
    kind={kind}
    setKind={setKind}
    description={description}
    setDescription={setDescription}
    projectId={projectId}
    threadId={threadId}
    returnFocusRef={returnFocusRef}
    onClose={onClose}
  />;
}

function OpenSupportDialog({ kind, setKind, description, setDescription, projectId, threadId, returnFocusRef, onClose }: {
  kind: SupportKind;
  setKind: Dispatch<SetStateAction<SupportKind>>;
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  projectId: string | null;
  threadId: string | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalFocus<HTMLDivElement>(true, () => !busy && onClose(), closeRef, returnFocusRef);

  const submit = async () => {
    if (!description.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        kind,
        description,
        context: {
          pathname: window.location.pathname,
          projectId,
          threadId,
          viewport: window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop",
        },
      }) });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || !result || typeof result !== "object" || !("request" in result)) {
        throw new Error(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "No se ha podido guardar la solicitud.");
      }
      const request = (result as { request?: { id?: unknown } }).request;
      setSentId(typeof request?.id === "string" ? request.id : "guardada");
      setDescription("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se ha podido guardar la solicitud."); }
    finally { setBusy(false); }
  };

  return <div className="workspace-overlay fixed inset-0 z-[70] grid place-items-center p-4" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="support-title" className="workspace-panel w-full max-w-xl rounded-[22px] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)] outline-none">
      <header className="workspace-panel-header flex items-center border-b border-[var(--border-subtle)] px-5"><div className="min-w-0 flex-1"><h2 id="support-title" className="workspace-panel-title">Ayuda y feedback</h2><p className="workspace-panel-subtitle mt-0.5">Se guarda primero; el aviso al equipo nunca bloquea el envío.</p></div><button ref={closeRef} type="button" aria-label="Cerrar" className="touch-target grid size-10 place-items-center rounded-full hover:bg-[var(--surface-hover)]" onClick={onClose}><X size={17} /></button></header>
      <form className="space-y-5 p-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <fieldset><legend className="text-[11px] font-semibold">Tipo</legend><div className="mt-2 grid grid-cols-3 gap-2">{choices.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)} className={`touch-target flex min-h-11 items-center justify-center gap-2 rounded-xl border text-[11px] font-semibold ${kind === id ? "border-[var(--brain-accent)] bg-[var(--brain-accent-soft)] text-[var(--brain-accent-on-soft)]" : "border-[var(--border)] text-[var(--text-secondary)]"}`}><Icon size={15} />{label}</button>)}</div></fieldset>
        <label htmlFor="support-description" className="block text-[11px] font-semibold">Descripción<textarea id="support-description" autoFocus value={description} maxLength={10_000} rows={7} required onChange={(event) => setDescription(event.target.value)} placeholder="Explica qué necesitas, qué esperabas y qué ocurrió." className="mt-2 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-[13px] font-normal leading-5 outline-none focus:border-[var(--brain-accent)]" /></label>
        <p className="text-[10px] leading-4 text-[var(--text-subtle)]">Incluiremos solo la ruta de la pantalla y los identificadores del proyecto/chat. No se envían mensajes, archivos, tokens, cookies ni parámetros de URL.</p>
        {sentId ? <p role="status" className="rounded-xl bg-[var(--positive-soft)] px-3 py-2 text-[11px] text-[var(--positive)]">Solicitud guardada · referencia {sentId}</p> : null}
        {error ? <p role="alert" className="rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-[11px] text-[var(--danger)]">{error}</p> : null}
        <div className="flex justify-end"><button type="submit" disabled={busy || !description.trim()} className="touch-target flex min-h-10 items-center gap-2 rounded-full bg-[var(--text)] px-4 text-[11px] font-semibold text-[var(--surface)] disabled:opacity-40">{busy ? <SpinnerGap size={14} className="animate-spin" /> : null}{busy ? "Guardando…" : "Enviar"}</button></div>
      </form>
    </div>
  </div>;
}
