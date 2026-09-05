"use client";

import type { ReactNode } from "react";
import styles from "./thinking-reasoning.module.css";
import { ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from "@/components/ui/thinking-steps";

/** Registry timeline composed with the incumbent disclosure and ordered events.
 * Children carry real activity, tool results, file previews and plan states.
 */
export function ToolTimeline({ open, onOpenChange, streaming, label, indicator, complete, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streaming: boolean;
  label: string;
  indicator: ReactNode;
  complete: boolean;
  children: ReactNode;
}) {
  return (
    <ThinkingSteps data-slot="tool-timeline" data-testid="turn-thinking-steps" size="compact" open={open} onOpenChange={onOpenChange} className={`w-full ${styles.reasoning}`}>
      <ThinkingStepsHeader
        aria-label={`${open ? "Ocultar" : "Mostrar"} el proceso de trabajo`}
        aria-live="polite"
        indicator={indicator}
        labelClassName={streaming ? styles.shimmer : styles.label}
        className={`${styles.header} max-w-full ${complete ? "codex-thinking-summary-complete" : ""}`}
      >{label}</ThinkingStepsHeader>
      <ThinkingStepsContent className="pt-1"><div className={styles.viewport} tabIndex={open ? 0 : -1} role="region" aria-label="Detalles del proceso de trabajo">{children}</div></ThinkingStepsContent>
    </ThinkingSteps>
  );
}
