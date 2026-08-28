"use client";

import { useState } from "react";
import { Plug, SpinnerGap } from "@phosphor-icons/react";
import type { ChatMessage } from "@/lib/chat-contract";
import {
  prepareManagedAppAction,
  type ManagedAppActionDescriptor,
} from "@/ui/codex-managed-app-ui";

export function ManagedAppActionControl({
  enabled,
  threadId,
  message,
  onPrepared,
}: {
  enabled: boolean;
  threadId: string;
  message: ChatMessage;
  onPrepared: (descriptor: ManagedAppActionDescriptor) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  if (!enabled) return null;

  const prepare = async () => {
    setBusy(true);
    setUnavailable(false);
    try {
      const descriptor = await prepareManagedAppAction(fetch, {
        threadId,
        turnId: message.id,
        itemId: message.id,
        approvalId: message.id,
      });
      if (!descriptor) {
        setUnavailable(true);
        return;
      }
      onPrepared(descriptor);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5" aria-label="Acción conectada">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><Plug size={14} aria-hidden="true" /><p className="text-[10px] font-medium text-[var(--text)]">Acción conectada disponible</p></div>
        <button type="button" disabled={busy} className="min-h-9 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] font-medium text-[var(--text)] disabled:opacity-50" onClick={() => void prepare()}>{busy ? <span className="inline-flex items-center gap-1"><SpinnerGap size={12} className="motion-safe:animate-spin" />Preparando</span> : "Solicitar aprobación"}</button>
      </div>
      {unavailable ? <p role="status" className="mt-2 text-[9px] text-[var(--text-muted)]">La acción conectada ya no está disponible.</p> : null}
    </section>
  );
}
