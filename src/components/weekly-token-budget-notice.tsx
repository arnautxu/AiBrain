"use client";

import { useEffect, useRef, useState } from "react";
import { useUiLocale, useUiText } from "@/i18n/provider";

type BudgetStatus = {
  weekStart: string;
  resetAt: string;
  limitTokens: number;
  usedTokens: number | null;
  remainingTokens: number | null;
  percent: number | null;
  threshold: 0 | 25 | 50 | 75 | 100;
  initialized: boolean;
};

function isBudgetStatus(value: unknown): value is BudgetStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BudgetStatus>;
  const count = (number: unknown) => typeof number === "number" && Number.isSafeInteger(number) && number >= 0;
  return typeof candidate.weekStart === "string" && Number.isFinite(Date.parse(candidate.weekStart)) &&
    typeof candidate.resetAt === "string" && Number.isFinite(Date.parse(candidate.resetAt)) &&
    count(candidate.limitTokens) && candidate.limitTokens! > 0 &&
    typeof candidate.initialized === "boolean" &&
    [0, 25, 50, 75, 100].includes(candidate.threshold ?? -1) &&
    (candidate.initialized
      ? count(candidate.usedTokens) && count(candidate.remainingTokens) &&
        typeof candidate.percent === "number" && Number.isFinite(candidate.percent) && candidate.percent >= 0
      : candidate.usedTokens === null && candidate.remainingTokens === null && candidate.percent === null);
}

export function WeeklyTokenBudgetNotice({ tenantId, userId, modalOpen = false }: {
  tenantId: string;
  userId: string;
  modalOpen?: boolean;
}) {
  const t = useUiText();
  const locale = useUiLocale();
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [warning, setWarning] = useState<{ weekStart: string; threshold: number } | null>(null);
  const seenRef = useRef(new Map<string, number>());

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/usage/budget", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Budget unavailable");
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("budget" in payload) ||
            (payload.budget !== null && !isBudgetStatus(payload.budget))) {
          throw new Error("Invalid budget response");
        }
        if (disposed) return;
        const next = payload.budget as BudgetStatus | null;
        setBudget(next);
        setUnavailable(Boolean(next && !next.initialized));
        if (!next || !next.initialized || next.threshold === 100 || next.threshold === 0) {
          setWarning(null);
          return;
        }
        const key = `aibrain.${tenantId}.${userId}.weekly-budget.${next.weekStart}`;
        let seen = seenRef.current.get(key) ?? 0;
        try {
          const saved = Number(localStorage.getItem(key));
          if ([25, 50, 75].includes(saved)) seen = Math.max(seen, saved);
        } catch { /* Browser storage is optional; deduplicate in memory for this visit. */ }
        if (next.threshold > seen) {
          // If several milestones passed while away, one notice shows the latest milestone.
          seenRef.current.set(key, next.threshold);
          try { localStorage.setItem(key, String(next.threshold)); } catch { /* Optional storage. */ }
          setWarning({ weekStart: next.weekStart, threshold: next.threshold });
        } else {
          setWarning((current) => current?.weekStart === next.weekStart ? current : null);
        }
      } catch {
        if (!disposed) setUnavailable(true);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [tenantId, userId]);

  if (!budget && !unavailable) return null;
  const exhausted = budget?.initialized && budget.threshold === 100;
  const count = (number: number) => new Intl.NumberFormat(locale).format(number);
  const reset = budget ? new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid",
  }).format(new Date(budget.resetAt)) : null;

  return (
    <section aria-label={t("Saldo semanal compartido")} className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2 text-[11px] leading-5 text-[var(--text-secondary)] sm:px-5">
      {unavailable ? <p role="alert" className="font-medium text-[var(--text)]">{t("No se puede comprobar el saldo semanal. No se pueden iniciar nuevas solicitudes.")}</p> : budget?.initialized ? <>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span>{t("Uso semanal compartido: {used} de {limit} tokens", { used: count(budget.usedTokens!), limit: count(budget.limitTokens) })}</span>
          <span>{t("Disponibles: {remaining}", { remaining: count(budget.remainingTokens!) })}</span>
        </div>
        <p>{t("Incluye caché. Se renueva el {date} (hora de Madrid).", { date: reset! })}</p>
        {exhausted ? <p role="alert" className="font-medium text-[var(--text)]">{t("Límite semanal agotado. Las nuevas solicitudes están bloqueadas hasta la renovación.")}</p> : warning ? <div role="status" aria-live="polite" aria-atomic="true" className="mt-1 flex items-center gap-2 font-medium text-[var(--text)]">
          <span className="min-w-0 flex-1">{t("Aviso: se ha alcanzado el {percent}% del límite semanal compartido.", { percent: warning.threshold })}</span>
          {!modalOpen ? <button type="button" onClick={() => setWarning(null)} className="touch-target shrink-0 rounded-lg px-2 font-medium hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" aria-label={t("Cerrar aviso de consumo semanal")}>{t("Entendido")}</button> : null}
        </div> : null}
      </> : null}
    </section>
  );
}
