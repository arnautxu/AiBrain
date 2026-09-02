"use client";

import type { ToolResult } from "@/lib/chat-contract";
import { ToolCall } from "@/components/assistant-ui/elements/tool-call";

export const ToolResultCard = ToolCall;

export function ToolResultList({ results, onOpenBrowser }: {
  results: readonly ToolResult[];
  onOpenBrowser?: () => void;
}) {
  if (results.length === 0) return null;
  return (
    <section aria-labelledby="tool-results-title" className="space-y-2">
      <h3 id="tool-results-title" className="text-[12px] font-semibold text-[var(--text-secondary)]">Resultados de herramientas</h3>
      {results.map((result) => (
        <ToolResultCard key={result.id} result={result} onOpenBrowser={onOpenBrowser} />
      ))}
    </section>
  );
}
