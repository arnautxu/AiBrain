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
import type { ApprovalDecision, ChatMessage } from "@/lib/chat-contract";
import { TurnActivity } from "@/components/turn-activity";

type DetailsPanelProps = {
  message: ChatMessage | null;
  open: boolean;
  onClose: () => void;
  onResolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
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
    return [{ path: "Canvis del torn", content: diff, ...countChanges(diff) }];
  }
  return sections.map((content, index) => {
    const header = content.match(/^diff --git a\/.+ b\/(.+)$/m);
    const destination = content.match(/^\+\+\+ b\/(.+)$/m);
    const path = destination?.[1] ?? header?.[1] ?? `Fitxer ${index + 1}`;
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
  const pending = message?.approvals.filter((approval) => approval.status === "pending").length ?? 0;
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  useEffect(() => {
    setTab(message?.diff ? "changes" : "activity");
    setActiveFile(0);
    setCopied(false);
  }, [message?.id, message?.diff]);

  const copyDiff = async () => {
    if (!message?.diff) return;
    await navigator.clipboard.writeText(message.diff);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <aside className={`review-panel fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-[#d9d7d2] bg-[#f6f6f4] shadow-[-24px_0_60px_-42px_rgba(30,28,24,.5)] transition-transform duration-200 xl:static xl:w-[410px] xl:shrink-0 xl:shadow-none ${open ? "translate-x-0" : "translate-x-full xl:hidden"}`}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#deddd8] px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <GitDiff size={15} className="shrink-0 text-[#68655f]" />
          <h2 className="truncate text-[11px] font-semibold text-[#34312d]">Review del torn</h2>
          {pending > 0 ? <span className="rounded-md bg-[#eee4cf] px-1.5 py-0.5 text-[8px] font-semibold text-[#826328]">{pending} pendent</span> : null}
        </div>
        <button aria-label="Tancar review" className="rounded-md p-1.5 text-[#77736d] transition hover:bg-[#e7e6e2] hover:text-[#2f2c28]" onClick={onClose}><X size={15} /></button>
      </header>

      <div className="flex h-10 shrink-0 items-end gap-1 border-b border-[#deddd8] px-3">
        <button aria-pressed={tab === "changes"} className={`review-tab ${tab === "changes" ? "review-tab-active" : ""}`} onClick={() => setTab("changes")}>
          Canvis {files.length ? <span className="tabular-nums text-[8px] text-[#8c8881]">{files.length}</span> : null}
        </button>
        <button aria-pressed={tab === "activity"} className={`review-tab ${tab === "activity" ? "review-tab-active" : ""}`} onClick={() => setTab("activity")}>
          Activitat {message?.activity.length ? <span className="tabular-nums text-[8px] text-[#8c8881]">{message.activity.length}</span> : null}
        </button>
      </div>

      {!message ? (
        <div className="grid min-h-0 flex-1 place-items-center p-7 text-center">
          <div className="max-w-56">
            <span className="mx-auto grid size-10 place-items-center rounded-xl bg-[#eae9e5] text-[#77736d]"><ListChecks size={18} /></span>
            <p className="mt-3 text-[11px] font-semibold text-[#4d4944]">Selecciona una resposta</p>
            <p className="mt-1.5 text-[9px] leading-4 text-[#918d86]">El review mostra canvis, activitat i aprovacions reals del torn.</p>
          </div>
        </div>
      ) : tab === "changes" ? (
        files.length ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e1dfda] bg-[#fbfbfa] px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-[9px] font-medium">
                <span className="text-[#4f7b58]">+{additions}</span>
                <span className="text-[#a45748]">−{deletions}</span>
                <span className="text-[#8e8a83]">{files.length} {files.length === 1 ? "fitxer" : "fitxers"}</span>
              </div>
              <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[9px] font-medium text-[#77736d] transition hover:bg-[#eeede9] hover:text-[#3e3b36]" onClick={() => void copyDiff()}>
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copiat" : "Copia diff"}
              </button>
            </div>

            <div className="scrollbar-thin flex max-h-36 shrink-0 flex-col overflow-y-auto border-b border-[#deddd8] bg-[#f2f1ee] p-1.5">
              {files.map((file, index) => (
                <button key={`${file.path}-${index}`} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${activeFile === index ? "bg-[#deddd8] text-[#34312d]" : "text-[#716d67] hover:bg-[#e8e7e3]"}`} onClick={() => setActiveFile(index)}>
                  <FileCode size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[9px]">{file.path}</span>
                  <span className="flex shrink-0 gap-1.5 font-mono text-[8px]"><span className="text-[#4f7b58]">+{file.additions}</span><span className="text-[#a45748]">−{file.deletions}</span></span>
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
              <span className="mx-auto grid size-10 place-items-center rounded-xl bg-[#e9eee9] text-[#58705d]"><ShieldCheck size={18} /></span>
              <p className="mt-3 text-[11px] font-semibold text-[#4d4944]">Sense canvis de fitxers</p>
              <p className="mt-1.5 text-[9px] leading-4 text-[#918d86]">Aquest torn no ha produït cap diff. Consulta Activitat per veure què ha executat.</p>
              <button className="mt-3 rounded-lg border border-[#d9d7d2] bg-white px-3 py-1.5 text-[9px] font-medium text-[#625e58] hover:bg-[#f7f6f3]" onClick={() => setTab("activity")}>Obre Activitat</button>
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
