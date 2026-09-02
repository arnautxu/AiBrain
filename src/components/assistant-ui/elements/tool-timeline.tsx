"use client";

import type { ReactNode } from "react";
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
    <ThinkingSteps data-slot="tool-timeline" data-testid="turn-thinking-steps" size="compact" open={open} onOpenChange={onOpenChange} className="w-full">
      <ThinkingStepsHeader
        aria-label={`${open ? "Ocultar" : "Mostrar"} el proceso de trabajo`}
        aria-live="polite"
        indicator={indicator}
        labelClassName={streaming ? "thinking-steps-shimmer" : "text-[var(--text-secondary)]"}
        className={complete ? "codex-thinking-summary-complete max-w-full" : "max-w-full"}
      >{label}</ThinkingStepsHeader>
      <ThinkingStepsContent className="pt-1">{children}</ThinkingStepsContent>
    </ThinkingSteps>
  );
}
