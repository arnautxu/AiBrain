"use client";

import { useEffect, useRef, useState } from "react";
import { WarningCircle, X } from "@phosphor-icons/react";

export function TextDialog({
  open,
  title,
  label,
  initialValue = "",
  maxLength = 120,
  submitLabel,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  maxLength?: number;
  submitLabel: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      setValue(initialValue);
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [initialValue, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/20 px-4 backdrop-blur-[2px]">
      <button aria-label="Cerrar diálogo" className="absolute inset-0" onClick={onClose} />
      <form
        className="panel-enter relative w-full max-w-[420px] rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-lg)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && !busy) onSubmit(value.trim());
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h2>
          <button type="button" aria-label="Cerrar" className="rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-hover)]" onClick={onClose}><X size={15} /></button>
        </div>
        <label className="mt-5 block">
          <span className="mb-2 block text-[12px] font-medium text-[var(--text-secondary)]">{label}</span>
          <input
            ref={inputRef}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-[13px] text-[var(--text)] outline-none focus:border-[var(--brain-accent)]"
            value={value}
            maxLength={maxLength}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-lg px-3.5 py-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]" onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={busy || !value.trim()} className="rounded-lg bg-[var(--brain-accent)] px-4 py-2 text-[12px] font-semibold text-[var(--brain-contrast)] disabled:opacity-40">{busy ? "Guardando…" : submitLabel}</button>
        </div>
      </form>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/20 px-4 backdrop-blur-[2px]">
      <button aria-label="Cerrar confirmación" className="absolute inset-0" onClick={onClose} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="panel-enter relative w-full max-w-[420px] rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-lg)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[#f7e9dd] text-[#9a5d39]"><WarningCircle size={16} /></span>
          <div>
            <h2 id="confirm-title" className="text-[14px] font-semibold text-[var(--text)]">{title}</h2>
            <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{description}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-lg px-3.5 py-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]" onClick={onClose}>Cancelar</button>
          <button disabled={busy} className="rounded-lg bg-[var(--danger)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40" onClick={onConfirm}>{busy ? "Archivando…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
