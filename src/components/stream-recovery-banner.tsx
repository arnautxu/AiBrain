"use client";
import { useUiText } from "@/i18n/provider";
import { WarningCircle } from "@phosphor-icons/react";

export function StreamRecoveryBanner({ attempt }: { attempt: number | null }) {
  const t = useUiText();
  if (attempt === null) return null;
  return (
    <div className="menu-enter flex min-h-11 items-center justify-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-2.5 text-center text-[12px] text-[var(--text-secondary)] shadow-[var(--shadow-popover)]" role="status" aria-live="polite">
      <WarningCircle size={15} className="shrink-0 text-[var(--text-subtle)]" />
      {" "}{t("Reconectando la respuesta (intento")}{" "}{attempt}{t("). El historial se conserva.")}{" "}</div>
  );
}
