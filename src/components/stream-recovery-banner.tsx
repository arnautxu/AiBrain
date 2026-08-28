import { WarningCircle } from "@phosphor-icons/react";

export function StreamRecoveryBanner({ attempt }: { attempt: number | null }) {
  if (attempt === null) return null;
  return (
    <div className="menu-enter flex min-h-11 items-center justify-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-2.5 text-center text-[12px] text-[var(--text-secondary)] shadow-[var(--shadow-popover)]" role="status" aria-live="polite">
      <WarningCircle size={15} className="shrink-0 text-[var(--text-subtle)]" />
      Reconectando la respuesta (intento {attempt}). El historial se conserva.
    </div>
  );
}
