"use client";

import { CheckCircle, FileCode, Globe, SpinnerGap, TerminalWindow, WarningCircle, Wrench } from "@phosphor-icons/react";
import type { ToolResult } from "@/lib/chat-contract";
import { publicActivityText, publicCommandTitle, publicToolOutput } from "@/ui/public-activity";

function ResultIcon({ result }: { result: ToolResult }) {
  if (result.status === "running") return <SpinnerGap size={14} className="motion-safe:animate-spin" />;
  if (result.status === "failed" || result.status === "stopped") return <WarningCircle size={14} />;
  if (result.kind === "command") return <TerminalWindow size={14} />;
  if (result.kind === "file") return <FileCode size={14} />;
  if (result.kind === "web" || result.kind === "browser") return <Globe size={14} />;
  return <Wrench size={14} />;
}

function statusLabel(result: ToolResult) {
  return { running: "En curso", complete: "Completado", failed: "Error", stopped: "Detenido" }[result.status];
}

export function ToolResultCard({ result, onOpenBrowser }: {
  result: ToolResult;
  onOpenBrowser?: () => void;
}) {
  const publicTitle = result.kind === "command"
    ? publicCommandTitle(result.title, result.status === "running")
    : publicActivityText(result.title, 240) ?? "Herramienta";
  const publicSummary = publicActivityText(result.summary, 4_000);
  const publicOutput = publicToolOutput(result.output);
  if (result.kind === "browser" && onOpenBrowser) {
    return (
      <button type="button" className="flex min-h-11 w-full items-center gap-2.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-left transition hover:bg-[var(--surface-hover)]" onClick={onOpenBrowser} aria-label={`Reabrir ${publicTitle}`}>
        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${result.status === "failed" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-muted)] text-[var(--text-secondary)]"}`}><ResultIcon result={result} /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold text-[var(--text)]">{publicTitle}</span><span className="mt-0.5 block text-[9px] text-[var(--text-muted)]">{statusLabel(result)}</span></span>
        {result.status === "complete" ? <CheckCircle size={14} className="text-[var(--positive)]" /> : null}
        <span aria-hidden className="text-[var(--text-muted)]">›</span>
      </button>
    );
  }
  return (
    <details className="group/tool overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface-raised)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-left [&::-webkit-details-marker]:hidden">
        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${result.status === "failed" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-muted)] text-[var(--text-secondary)]"}`}><ResultIcon result={result} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold text-[var(--text)]">{publicTitle}</span>
          <span className="mt-0.5 block text-[9px] text-[var(--text-muted)]">{statusLabel(result)}{result.sourceIds.length ? ` · ${result.sourceIds.length} ${result.sourceIds.length === 1 ? "fuente" : "fuentes"}` : ""}</span>
        </span>
        {result.status === "complete" ? <CheckCircle size={14} className="text-[var(--positive)]" /> : null}
        <span aria-hidden className="text-[var(--text-muted)] transition group-open/tool:rotate-90">›</span>
      </summary>
      <div className="border-t border-[var(--border-subtle)] px-3 py-3">
        {publicSummary ? <p className="text-[10px] leading-4 text-[var(--text-muted)]">{publicSummary}</p> : null}
        {publicOutput ? <pre tabIndex={0} aria-label={`Salida de ${publicTitle}`} className="scrollbar-thin mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[#222220] px-3 py-2.5 font-mono text-[9px] leading-4 text-[#deddd9]">{publicOutput}</pre> : <p className="mt-1 text-[10px] text-[var(--text-subtle)]">La herramienta no entregó una salida textual.</p>}
      </div>
    </details>
  );
}

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
