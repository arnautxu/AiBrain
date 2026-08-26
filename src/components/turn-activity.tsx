"use client";

import {
  Brain,
  Check,
  Circle,
  FileCode,
  GitDiff,
  Globe,
  ListChecks,
  Robot,
  ShieldCheck,
  SpinnerGap,
  TerminalWindow,
  Wrench,
  X,
} from "@phosphor-icons/react";
import type {
  ActivityItem,
  ApprovalDecision,
  ApprovalItem,
  ChatMessage,
} from "@/lib/chat-contract";

type TurnActivityProps = {
  message: ChatMessage;
  compact?: boolean;
  showDiff?: boolean;
  onResolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
};

function ActivityIcon({ item }: { item: ActivityItem }) {
  if (item.status === "running" || item.status === "waiting") {
    return <SpinnerGap size={13} className="motion-safe:animate-spin" />;
  }
  if (item.status === "failed" || item.status === "stopped") return <X size={12} weight="bold" />;

  const props = { size: 13, weight: "regular" as const };
  if (item.kind === "command") return <TerminalWindow {...props} />;
  if (item.kind === "file") return <FileCode {...props} />;
  if (item.kind === "web") return <Globe {...props} />;
  if (item.kind === "agent") return <Robot {...props} />;
  if (item.kind === "reasoning") return <Brain {...props} />;
  if (item.kind === "plan") return <ListChecks {...props} />;
  if (item.kind === "tool") return <Wrench {...props} />;
  return <Check {...props} weight="bold" />;
}

function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: ApprovalItem;
  onResolve: (decision: ApprovalDecision) => void;
}) {
  const pending = approval.status === "pending";
  const result = {
    accepted: "Aprovat una vegada",
    accepted_session: "Aprovat per a la sessió",
    declined: "Rebutjat",
    pending: "Esperant decisió",
  }[approval.status];

  return (
    <div className="overflow-hidden rounded-[var(--brain-radius)] border border-[#deddd9] bg-[#fbfbfa]">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[#f0efec] text-[#464541]">
          <ShieldCheck size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-[#282725]">{approval.title}</p>
          <p className="mt-1 text-[10px] leading-4 text-[#77746f]">{approval.detail}</p>
          {approval.command ? (
            <pre tabIndex={0} className="scrollbar-thin mt-2 overflow-x-auto rounded-lg bg-[#20201f] px-3 py-2 font-mono text-[9px] leading-4 text-[#e9e8e4]">
              {approval.command}
            </pre>
          ) : null}
          {approval.cwd ? <p className="mt-1.5 truncate font-mono text-[9px] text-[#999691]">{approval.cwd}</p> : null}
        </div>
      </div>

      {pending ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#e6e5e1] bg-white px-3 py-2.5">
          <button className="rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-[#716e69] hover:bg-[#f2f1ee]" onClick={() => onResolve("decline")}>Rebutja</button>
          {approval.kind === "command" ? (
            <button className="rounded-lg border border-[#deddd9] px-2.5 py-1.5 text-[10px] font-medium text-[#4e4c48] hover:bg-[#f6f5f2]" onClick={() => onResolve("acceptForSession")}>Durant la sessió</button>
          ) : null}
          <button className="rounded-lg bg-[var(--brain-accent)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--brain-contrast)]" onClick={() => onResolve("accept")}>Permet una vegada</button>
        </div>
      ) : (
        <div className="border-t border-[#e6e5e1] px-3.5 py-2 text-[9px] font-medium text-[#77746f]">{result}</div>
      )}
    </div>
  );
}

export function TurnActivity({ message, compact = false, showDiff = true, onResolveApproval }: TurnActivityProps) {
  const hasDetails = message.plan.length > 0 || message.activity.length > 0 || message.approvals.length > 0 || Boolean(message.diff);
  if (!hasDetails) return null;

  return (
    <div className={compact ? "space-y-4" : "mt-4 space-y-3"}>
      {message.plan.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold text-[#77746f]">
            <ListChecks size={13} />
            Pla
          </div>
          <ol className="space-y-1.5">
            {message.plan.map((step, index) => (
              <li key={`${step.step}-${index}`} className="flex items-start gap-2 text-[10px] leading-4 text-[#625f5a]">
                <span className={`mt-[3px] grid size-3.5 shrink-0 place-items-center rounded-full ${
                  step.status === "completed"
                    ? "bg-[#e8eee8] text-[#51705a]"
                    : step.status === "in_progress"
                      ? "bg-[var(--brain-accent-soft)] text-[var(--brain-accent)]"
                      : "text-[#aaa7a2]"
                }`}>
                  {step.status === "completed" ? <Check size={8} weight="bold" /> : step.status === "in_progress" ? <SpinnerGap size={8} className="motion-safe:animate-spin" /> : <Circle size={8} />}
                </span>
                <span>{step.step}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {message.activity.length > 0 ? (
        <section className="overflow-hidden rounded-[var(--brain-radius)] border border-[#e2e1dd] bg-[#f9f9f8]">
          {message.activity.map((item, index) => (
            <div key={item.id} className={`flex items-start gap-2.5 px-3 py-2.5 ${index > 0 ? "border-t border-[#e8e7e3]" : ""}`}>
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md ${
                item.status === "failed" ? "bg-[#f8eae6] text-[#9d4f3a]" : "bg-white text-[#6d6a65]"
              }`}>
                <ActivityIcon item={item} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium text-[#4b4945]">{item.label}</p>
                {item.detail ? <p className="mt-0.5 truncate text-[9px] text-[#6f6c67]">{item.detail}</p> : null}
                {item.output ? (
                  <details className="mt-2">
                    <summary className="w-fit cursor-pointer text-[9px] font-medium text-[#6d6a65]">Mostra la sortida</summary>
                    <pre tabIndex={0} className="scrollbar-thin mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[#222220] px-2.5 py-2 font-mono text-[9px] leading-4 text-[#deddd9]">{item.output}</pre>
                  </details>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {message.approvals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} onResolve={(decision) => onResolveApproval(approval.id, decision)} />
      ))}

      {message.diff && showDiff ? (
        <section>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold text-[#77746f]">
            <GitDiff size={13} />
            Diff del torn
          </div>
          <pre tabIndex={0} className="diff-view scrollbar-thin max-h-64 overflow-auto rounded-[var(--brain-radius)] border border-[#deddd9] bg-[#20201f] px-3 py-3 font-mono text-[9px] leading-4 text-[#e7e5e1]">{message.diff}</pre>
        </section>
      ) : null}
    </div>
  );
}
