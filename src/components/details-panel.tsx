"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  FileCode,
  GitDiff,
  ListChecks,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import type { ApprovalDecision, ApprovalItem, ChatMessage } from "@/lib/chat-contract";
import { TurnActivity } from "@/components/turn-activity";
import { useModalFocus } from "@/ui/use-modal-focus";

type DetailsPanelProps = {
  message: ChatMessage | null;
  open: boolean;
  onClose: () => void;
  onResolveApproval: (approval: ApprovalItem, decision: ApprovalDecision) => void;
};

type DiffFile = {
  path: string;
  content: string;
  additions: number;
  deletions: number;
};

function countChanges(content: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of content.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function parseDiff(diff: string): DiffFile[] {
  if (!diff.trim()) return [];
  const sections = diff.split(/(?=^diff --git )/m).filter((section) => section.trim());
  if (!sections.length || !sections[0]?.startsWith("diff --git ")) {
    return [{ path: "Cambios del turno", content: diff, ...countChanges(diff) }];
  }
  return sections.map((content, index) => {
    const header = content.match(/^diff --git a\/.+ b\/(.+)$/m);
    const destination = content.match(/^\+\+\+ b\/(.+)$/m);
    const path = destination?.[1] ?? header?.[1] ?? `Archivo ${index + 1}`;
    return { path, content, ...countChanges(content) };
  });
}

function DiffCode({ content }: { content: string }) {
  return (
    <pre tabIndex={0} className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-[#1f201e] py-3 font-mono text-[9px] leading-[1.65] text-[#d9d8d4] outline-none">
      {content.split("\n").map((line, index) => {
        const kind = line.startsWith("+") && !line.startsWith("+++")
          ? "addition"
          : line.startsWith("-") && !line.startsWith("---")
            ? "deletion"
            : line.startsWith("@@")
              ? "hunk"
              : "context";
        return (
          <span key={`${index}-${line.slice(0, 20)}`} className={`diff-line diff-line-${kind}`}>
            <span aria-hidden="true" className="diff-line-number">{index + 1}</span>
            <span>{line || " "}</span>
          </span>
        );
      })}
    </pre>
  );
}

export function DetailsPanel({ message, open, onClose, onResolveApproval }: DetailsPanelProps) {
  const files = useMemo(() => parseDiff(message?.diff ?? ""), [message?.diff]);
  const [tab, setTab] = useState<"changes" | "activity">("changes");
  const [activeFile, setActiveFile] = useState(0);
  const [copied, setCopied] = useState(false);
  const [mobileOverlay, setMobileOverlay] = useState(false);
  const panelRef = useModalFocus<HTMLElement>(open && mobileOverlay, onClose);
  const pending = message?.approvals.filter((approval) => approval.status === "pending").length ?? 0;
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setTab(message?.diff ? "changes" : "activity");
      setActiveFile(0);
      setCopied(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [message?.id, message?.diff]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1279px)");
    const sync = () => setMobileOverlay(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const copyDiff = async () => {
    if (!message?.diff) return;
    await navigator.clipboard.writeText(message.diff);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <aside
      ref={panelRef}
      aria-label="Review del turno"
      aria-modal={open && mobileOverlay ? "true" : undefined}
      role={open && mobileOverlay ? "dialog" : undefined}
      tabIndex={open && mobileOverlay ? -1 : undefined}
      className={`review-panel fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-[var(--shadow-lg)] transition-transform duration-200 xl:static xl:w-[410px] xl:shrink-0 xl:pb-0 xl:pt-0 xl:shadow-none ${open ? "translate-x-0" : "translate-x-full xl:hidden"}`}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <GitDiff size={15} className="shrink-0 text-[var(--text-secondary)]" />
          <h2 className="truncate text-[11px] font-semibold text-[var(--text)]">Review del turno</h2>
          {pending > 0 ? <span className="rounded-md bg-[var(--warning-soft)] px-1.5 py-0.5 text-[8px] font-semibold text-[var(--warning)]">{pending} {pending === 1 ? "pendiente" : "pendientes"}</span> : null}
        </div>
        <button type="button" aria-label="Cerrar Review" className="touch-target rounded-md p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onClose}><X size={15} /></button>
      </header>

      <div className="flex h-10 shrink-0 items-end gap-1 border-b border-[var(--border)] px-3">
        <button type="button" aria-pressed={tab === "changes"} className={`review-tab ${tab === "changes" ? "review-tab-active" : ""}`} onClick={() => setTab("changes")}>
          Cambios {files.length ? <span className="tabular-nums text-[8px] text-[var(--text)]">{files.length}</span> : null}
        </button>
        <button type="button" aria-pressed={tab === "activity"} className={`review-tab ${tab === "activity" ? "review-tab-active" : ""}`} onClick={() => setTab("activity")}>
          Actividad {message?.activity.length ? <span className="tabular-nums text-[8px] text-[var(--text)]">{message.activity.length}</span> : null}
        </button>
      </div>

      {!message ? (
        <div className="grid min-h-0 flex-1 place-items-center p-7 text-center">
          <div className="max-w-56">
            <span className="mx-auto grid size-10 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--text-secondary)]"><ListChecks size={18} /></span>
            <p className="mt-3 text-[11px] font-semibold text-[var(--text)]">Selecciona una respuesta</p>
            <p className="mt-1.5 text-[9px] leading-4 text-[var(--text)]">Review muestra los cambios, la actividad y las aprobaciones del turno.</p>
          </div>
        </div>
      ) : tab === "changes" ? (
        files.length ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-[9px] font-medium">
                <span className="text-[var(--positive)]">+{additions}</span>
                <span className="text-[var(--danger)]">−{deletions}</span>
                <span className="text-[var(--text)]">{files.length} {files.length === 1 ? "archivo" : "archivos"}</span>
              </div>
              <button type="button" className="flex min-h-10 items-center gap-1.5 rounded-md px-2 py-1 text-[9px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-muted)]" onClick={() => void copyDiff()}>
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copiado" : "Copiar diff"}
              </button>
            </div>

            <div className="scrollbar-thin flex max-h-36 shrink-0 flex-col overflow-y-auto border-b border-[var(--border)] bg-[var(--surface-muted)] p-1.5">
              {files.map((file, index) => (
                <button type="button" key={`${file.path}-${index}`} className={`flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${activeFile === index ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`} onClick={() => setActiveFile(index)}>
                  <FileCode size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[9px]">{file.path}</span>
                  <span className="flex shrink-0 gap-1.5 font-mono text-[8px] font-semibold text-[var(--text)]"><span>+{file.additions}</span><span>−{file.deletions}</span></span>
                </button>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col bg-[#1f201e]">
              <div className="flex h-8 shrink-0 items-center border-b border-white/10 px-3.5 font-mono text-[8px] text-[#aaa9a5]">{files[activeFile]?.path}</div>
              {files[activeFile] ? <DiffCode content={files[activeFile].content} /> : null}
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center p-7 text-center">
            <div className="max-w-56">
              <span className="mx-auto grid size-10 place-items-center rounded-xl bg-[var(--positive-soft)] text-[var(--positive)]"><ShieldCheck size={18} /></span>
              <p className="mt-3 text-[11px] font-semibold text-[var(--text)]">Sin cambios en archivos</p>
              <p className="mt-1.5 text-[9px] leading-4 text-[var(--text)]">Este turno no ha producido ningún diff. Consulta Actividad para ver qué se ha ejecutado.</p>
              <button type="button" className="mt-3 min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-[9px] font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]" onClick={() => setTab("activity")}>Abrir Actividad</button>
            </div>
          </div>
        )
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <TurnActivity message={message} compact showDiff={false} onResolveApproval={onResolveApproval} />
        </div>
      )}
    </aside>
  );
}
