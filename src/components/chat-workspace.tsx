"use client";

import { useEffect, useRef, useState } from "react";
import NextImage from "next/image";
import {
  ArrowUp,
  CaretRight,
  CheckCircle,
  Code,
  Command,
  Copy,
  DownloadSimple,
  FolderOpen,
  Globe,
  GitDiff,
  HardDrives,
  Image as ImageIcon,
  ImagesSquare,
  List,
  Paperclip,
  GitBranch,
  MagicWand,
  SidebarSimple,
  SlidersHorizontal,
  SpinnerGap,
  Stop,
  WarningCircle,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { GuidedActions } from "@/components/guided-actions";
import type { ApprovalDecision, ChatInputAttachment, ChatMessage, ComposerMode } from "@/lib/chat-contract";
import type { BrainManifest, BrainPreferences, BrainWindow, BrainWindowId } from "@/config/brain";
import type { RuntimeReasoningEffort, RuntimeStatus } from "@/lib/runtime-status";
import type { WorkbenchProject, WorkbenchThread } from "@/workbench/types";
import { TurnActivity } from "@/components/turn-activity";

type ChatWorkspaceProps = {
  manifest: BrainManifest;
  preferences: BrainPreferences;
  project: WorkbenchProject | null;
  thread: WorkbenchThread | null;
  hydrated: boolean;
  prompt: string;
  composerMode: ComposerMode;
  composerModel: string | null;
  composerEffort: RuntimeReasoningEffort | null;
  webSearch: boolean;
  imageGeneration: boolean;
  selectedSkill: string | null;
  attachments: ChatInputAttachment[];
  sending: boolean;
  runtimeStatus: RuntimeStatus;
  onPromptChange: (value: string) => void;
  onComposerModeChange: (value: ComposerMode) => void;
  onComposerModelChange: (value: string | null) => void;
  onComposerEffortChange: (value: RuntimeReasoningEffort | null) => void;
  onWebSearchChange: (value: boolean) => void;
  onImageGenerationChange: (value: boolean) => void;
  onSelectedSkillChange: (value: string | null) => void;
  onAttachmentsChange: (value: ChatInputAttachment[]) => void;
  onComposerNotice: (message: string) => void;
  onSend: (message?: string, displayMessage?: string) => void;
  onStop: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenCommandPalette: () => void;
  onOpenCustomization: () => void;
  enabledWindows: BrainWindow[];
  activeSideWindow: Exclude<BrainWindowId, "chat"> | null;
  onOpenWindow: (windowId: Exclude<BrainWindowId, "chat">) => void;
  canInspect: boolean;
  onInspectMessage: (messageId: string) => void;
  onResolveApproval: (
    messageId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ) => Promise<void>;
  onCreateVersion: (message: ChatMessage) => void;
  onResultAction: (message: ChatMessage, action: "approved" | "pending" | "undo") => Promise<void>;
  showAdvancedControls: boolean;
};

function ResultActions({ message, onCreateVersion, onResultAction }: { message: ChatMessage; onCreateVersion: () => void; onResultAction: (action: "approved" | "pending" | "undo") => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const approved = message.activity.some((item) => item.id === "result-review" && item.label === "Resultat aprovat");
  const copyResult = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const downloadResult = () => {
    const blob = new Blob([message.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `resultat-aibrain-${message.createdAt.slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const review = async () => {
    setBusy(true);
    try { await onResultAction(approved ? "pending" : "approved"); } finally { setBusy(false); }
  };
  return <div className="mt-4 flex flex-wrap items-center gap-1.5"><button type="button" disabled={busy} aria-pressed={approved} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition ${approved ? "border-[#c8d8ca] bg-[#edf5ee] text-[#4f7255]" : "border-[#dfddd8] bg-white text-[#66625d] hover:bg-[#f4f3f0]"}`} onClick={() => void review()}><CheckCircle size={13} />{approved ? "Resultat aprovat" : "Aprova resultat"}</button><button type="button" className="flex items-center gap-1.5 rounded-lg border border-[#dfddd8] bg-white px-3 py-2 text-[12px] font-medium text-[#66625d] hover:bg-[#f4f3f0]" onClick={() => void copyResult()}><Copy size={13} />{copied ? "Copiat" : "Copia"}</button><button type="button" className="flex items-center gap-1.5 rounded-lg border border-[#dfddd8] bg-white px-3 py-2 text-[12px] font-medium text-[#66625d] hover:bg-[#f4f3f0]" onClick={downloadResult}><DownloadSimple size={13} />Descarrega</button><button type="button" className="flex items-center gap-1.5 rounded-lg border border-[#dfddd8] bg-white px-3 py-2 text-[12px] font-medium text-[#66625d] hover:bg-[#f4f3f0]" onClick={onCreateVersion}><GitBranch size={13} />Nova versió</button>{message.diff ? <button type="button" className="flex items-center gap-1.5 rounded-lg border border-[#ead7cf] bg-[#fff5f1] px-3 py-2 text-[12px] font-medium text-[#8a513e] hover:bg-[#f9e6de]" onClick={() => void onResultAction("undo")}>Desfés els canvis</button> : null}</div>;
}

function AssistantMessage({
  message,
  assistantName,
  showActivity,
  onInspect,
  onResolveApproval,
  canInspect,
  showInlineDiff,
  isLatest,
  onFollowUp,
  onCreateVersion,
  onResultAction,
}: {
  message: ChatMessage;
  assistantName: string;
  showActivity: boolean;
  onInspect: () => void;
  onResolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
  canInspect: boolean;
  showInlineDiff: boolean;
  isLatest: boolean;
  onFollowUp: (message: string) => void;
  onCreateVersion: () => void;
  onResultAction: (message: ChatMessage, action: "approved" | "pending" | "undo") => Promise<void>;
}) {
  const hasDetails = message.activity.length > 0 || message.plan.length > 0 || message.approvals.length > 0 || Boolean(message.diff);

  return (
    <article className="message-enter group">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-md bg-[var(--brain-accent)] text-[var(--brain-contrast)]">
          <Code size={12} weight="bold" />
        </span>
        <span className="text-[11px] font-semibold text-[#3b3936]">{assistantName}</span>
      </div>

      {showActivity ? (
        <TurnActivity message={message} showDiff={showInlineDiff} onResolveApproval={onResolveApproval} />
      ) : null}

      {message.status === "streaming" && !message.content ? (
        <div className="mt-4 space-y-2.5 py-1" aria-label="Preparant resposta">
          <div className="skeleton-line h-3.5 w-[74%]" />
          <div className="skeleton-line h-3.5 w-[56%]" />
        </div>
      ) : message.content ? (
        <div className="mt-4 max-w-[76ch] whitespace-pre-wrap text-[14px] leading-7 text-[#2c2b29] md:text-[14.5px]">
          {message.content}
          {message.status === "streaming" ? <span className="stream-caret ml-0.5 inline-block h-4 w-[2px] bg-[var(--brain-accent)] align-middle" /> : null}
        </div>
      ) : null}

      {message.status === "error" ? (
        <div className="mt-3 flex max-w-xl items-start gap-2 rounded-[var(--brain-radius)] border border-[#ead0c7] bg-[#fff8f5] px-3 py-2.5 text-[11px] text-[#884b38]">
          <WarningCircle size={15} className="mt-0.5 shrink-0" />
          <span>El torn no s’ha pogut completar. Revisa l’estat del runtime i torna-ho a provar.</span>
        </div>
      ) : null}

      {message.status === "stopped" ? <p className="mt-3 text-[10px] text-[#6d6a65]">Torn aturat.</p> : null}

      {message.artifacts.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {message.artifacts.map((artifact) => (
            <figure key={artifact.id} className="overflow-hidden rounded-[calc(var(--brain-radius)+2px)] border border-[#dedcd7] bg-[#f4f3f0]">
              <a href={artifact.url} target="_blank" rel="noreferrer"><NextImage unoptimized width={720} height={720} src={artifact.url} alt={artifact.prompt ?? artifact.name} className="aspect-square w-full object-cover" /></a>
              <figcaption className="flex items-center gap-2 px-3 py-2 text-[9px] text-[#716d67]"><ImagesSquare size={12} /><span className="min-w-0 flex-1 truncate">{artifact.prompt ?? artifact.name}</span><a href={artifact.url} download={artifact.name} className="font-medium text-[#403d39] hover:underline">Descarrega</a></figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {message.status === "complete" && message.content ? <ResultActions message={message} onCreateVersion={onCreateVersion} onResultAction={(action) => onResultAction(message, action)} /> : null}

      {isLatest && message.status === "complete" ? <div className="mt-5 border-t border-[#e5e3df] pt-4"><p className="text-[12px] font-medium text-[#918d86]">Què vols fer ara?</p><div className="mt-2 flex flex-wrap gap-1.5"><button type="button" className="rounded-lg bg-[#f0efec] px-3 py-2 text-[12px] font-medium text-[#625f5a] hover:bg-[#e7e5e1]" onClick={() => onFollowUp("Explica’m aquest resultat de manera més senzilla i destaca només el que he de saber.")}>Explica-ho més fàcil</button><button type="button" className="rounded-lg bg-[#f0efec] px-3 py-2 text-[12px] font-medium text-[#625f5a] hover:bg-[#e7e5e1]" onClick={() => onFollowUp("A partir d’aquest resultat, dona’m els següents passos concrets i ordenats.")}>Següents passos</button><button type="button" className="rounded-lg bg-[#f0efec] px-3 py-2 text-[12px] font-medium text-[#625f5a] hover:bg-[#e7e5e1]" onClick={() => onFollowUp("Prepara una versió final, neta i llesta per utilitzar d’aquest resultat.")}>Prepara la versió final</button></div></div> : null}

      {hasDetails && canInspect ? (
        <button className="mt-3 flex items-center gap-1.5 rounded-md py-1 text-[10px] font-medium text-[#67645f] transition hover:text-[#34322f]" onClick={onInspect}>
          <List size={12} />
          Obre Review
        </button>
      ) : null}
    </article>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <article className="message-enter flex justify-end">
      <div className="max-w-[86%] rounded-[var(--brain-radius)] rounded-br-[4px] bg-[#ecebe8] px-4 py-3 text-[13px] leading-6 text-[#33312e] md:max-w-[70%]">
        {message.attachments.length ? (
          <div className="mb-2 flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((attachment) => (
              <span key={attachment.id} className="flex max-w-52 items-center gap-1.5 rounded-md bg-white/70 px-2 py-1 text-[9px] text-[#625f5a]">
                <ImageIcon size={11} /><span className="truncate">{attachment.name}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div>{message.content}</div>
      </div>
    </article>
  );
}

export function ChatWorkspace({
  manifest,
  preferences,
  project,
  thread,
  hydrated,
  prompt,
  composerMode,
  composerModel,
  composerEffort,
  webSearch,
  imageGeneration,
  selectedSkill,
  attachments,
  sending,
  runtimeStatus,
  onPromptChange,
  onComposerModeChange,
  onComposerModelChange,
  onComposerEffortChange,
  onWebSearchChange,
  onImageGenerationChange,
  onSelectedSkillChange,
  onAttachmentsChange,
  onComposerNotice,
  onSend,
  onStop,
  sidebarOpen,
  onToggleSidebar,
  onOpenCommandPalette,
  onOpenCustomization,
  enabledWindows,
  activeSideWindow,
  onOpenWindow,
  canInspect,
  onInspectMessage,
  onResolveApproval,
  onCreateVersion,
  onResultAction,
  showAdvancedControls,
}: ChatWorkspaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [guidedActionsOpen, setGuidedActionsOpen] = useState(false);
  const [manualComposerOpen, setManualComposerOpen] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread?.messages]);

  const hasMessages = Boolean(thread?.messages.length);
  const guideVisible = guidedActionsOpen || (!hasMessages && !manualComposerOpen);
  const latestAssistantId = thread?.messages.findLast((message) => message.role === "assistant")?.id ?? null;
  const runtimeLabel = runtimeStatus.mode === "codex" ? "Codex" : "Demo";
  const canAttachImages = manifest.composer.images && (runtimeStatus.mode === "demo" || runtimeStatus.capabilities.imageInput);
  const canUseWeb = manifest.composer.webSearch && (runtimeStatus.mode === "demo" || runtimeStatus.capabilities.webSearch);
  const canGenerateImages = manifest.composer.imageGeneration && (runtimeStatus.mode === "demo" || runtimeStatus.capabilities.imageGeneration);
  const selectedModelOption = runtimeStatus.models.find((model) => model.id === composerModel) ??
    runtimeStatus.models.find((model) => model.isDefault) ?? runtimeStatus.models[0] ?? null;
  const effortOptions = selectedModelOption?.supportedReasoningEfforts.length
    ? selectedModelOption.supportedReasoningEfforts
    : (["low", "medium", "high"] satisfies RuntimeReasoningEffort[]);
  const effortLabels: Record<RuntimeReasoningEffort, string> = {
    none: "Sense raonament",
    minimal: "Mínim",
    low: "Ràpid",
    medium: "Equilibrat",
    high: "Profund",
    xhigh: "Molt profund",
    max: "Màxim",
    ultra: "Ultra",
  };

  useEffect(() => {
    if (!composerEffort || !selectedModelOption?.supportedReasoningEfforts.length) return;
    if (selectedModelOption.supportedReasoningEfforts.includes(composerEffort)) return;
    onComposerEffortChange(
      selectedModelOption.defaultReasoningEffort ??
        selectedModelOption.supportedReasoningEfforts[0] ??
        null,
    );
  }, [composerEffort, onComposerEffortChange, selectedModelOption]);

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const available = Math.max(0, 3 - attachments.length);
    const selected = Array.from(files).slice(0, available);
    if (files.length > available) onComposerNotice("Pots adjuntar un màxim de 3 imatges per torn.");
    const next: ChatInputAttachment[] = [];
    for (const file of selected) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        onComposerNotice(`${file.name} no és una imatge compatible.`);
        continue;
      }
      if (file.size > 2_000_000) {
        onComposerNotice(`${file.name} supera el límit de 2 MB.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("invalid"));
        reader.onerror = () => reject(reader.error ?? new Error("read"));
        reader.readAsDataURL(file);
      }).catch(() => "");
      if (!dataUrl) {
        onComposerNotice(`No s’ha pogut llegir ${file.name}.`);
        continue;
      }
      next.push({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size, dataUrl });
    }
    if (next.length) onAttachmentsChange([...attachments, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <main className="workbench-main relative flex min-w-0 flex-1 flex-col bg-[#fbfbfa]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#e2e0db] px-2.5 md:px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <button aria-label="Mostra o amaga la barra lateral" className={`rounded-md p-1.5 text-[#74716c] transition hover:bg-[#efeeeb] hover:text-[#312f2b] ${sidebarOpen ? "md:hidden" : "md:block"}`} onClick={onToggleSidebar}>
            <SidebarSimple size={17} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1">
            <FolderOpen size={13} className="hidden shrink-0 text-[#77736d] sm:block" weight="fill" />
            <span className="hidden max-w-36 truncate text-[10px] font-medium text-[#66625c] sm:block">{project?.name ?? runtimeStatus.projectName}</span>
            {thread ? <CaretRight size={10} className="hidden shrink-0 text-[#aaa69f] sm:block" /> : null}
            <span className="max-w-[52vw] truncate text-[11px] font-semibold text-[#34312d] sm:max-w-72">{thread?.title ?? (project ? "Nou fil" : runtimeStatus.workspaceName)}</span>
          </div>
          <span className="hidden items-center gap-1.5 text-[9px] text-[#8b8882] sm:flex">
            <span className={`size-1.5 rounded-full ${runtimeStatus.ready ? "bg-[#4f8a5d]" : runtimeStatus.codex === "checking" ? "bg-[#d4a64c] motion-safe:animate-pulse" : "bg-[#aaa7a1]"}`} />
            {runtimeStatus.ready ? "Connectat" : runtimeStatus.codex === "checking" ? "Comprovant" : runtimeLabel}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {enabledWindows.filter((window) => window.id !== "chat").map((window) => {
            const windowId = window.id as Exclude<BrainWindowId, "chat">;
            const active = activeSideWindow === windowId;
            return (
              <button
                key={window.id}
                aria-label={`Obrir ${window.label}`}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[9px] font-medium transition ${active ? "bg-[var(--brain-accent-soft)] text-[var(--brain-accent)]" : "text-[#77746f] hover:bg-[#efeeeb] hover:text-[#2f2d2a]"}`}
                onClick={() => onOpenWindow(windowId)}
              >
                {windowId === "inspector" ? <GitDiff size={14} /> : <HardDrives size={14} />}
                <span className="hidden xl:inline">{window.label}</span>
              </button>
            );
          })}
          <button aria-label="Obrir cerca i ordres" className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-[9px] font-medium text-[#77746f] transition hover:bg-[#efeeeb] hover:text-[#2f2d2a] sm:flex" onClick={onOpenCommandPalette}>
            <Command size={13} /><span>⌘K</span>
          </button>
          <button aria-label="Personalitzar" className="rounded-md p-1.5 text-[#77746f] hover:bg-[#efeeeb] hover:text-[#2f2d2a]" onClick={onOpenCustomization}>
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {!hydrated ? (
          <div className="mx-auto max-w-3xl px-6 py-14">
            <div className="mb-8 h-7 w-48 rounded-md bg-[#eeedea] motion-safe:animate-pulse" />
            <div className="space-y-4"><div className="h-20 rounded-xl bg-[#f1f0ed] motion-safe:animate-pulse" /><div className="h-14 rounded-xl bg-[#f3f2ef] motion-safe:animate-pulse" /></div>
          </div>
        ) : guideVisible ? (
          <GuidedActions projectId={project?.id ?? null} projectName={project?.name ?? runtimeStatus.projectName} onCancel={hasMessages ? () => setGuidedActionsOpen(false) : undefined} onWriteDirectly={!hasMessages ? () => setManualComposerOpen(true) : undefined} onStart={(message, summary) => { setGuidedActionsOpen(false); setManualComposerOpen(true); onSend(message, summary); }} />
        ) : (
          <div className={`mx-auto w-full max-w-[760px] px-5 md:px-8 ${preferences.density === "compact" ? "py-6" : "py-9"}`}>
            <div className={preferences.density === "compact" ? "space-y-6" : "space-y-9"}>
              {thread?.messages.map((message) => message.role === "user" ? (
                <UserMessage key={message.id} message={message} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  assistantName={preferences.assistantName}
                  showActivity={preferences.showActivityPanel}
                  onInspect={() => onInspectMessage(message.id)}
                  onResolveApproval={(approvalId, decision) => void onResolveApproval(message.id, approvalId, decision)}
                  canInspect={canInspect}
                  showInlineDiff={activeSideWindow !== "inspector"}
                  isLatest={message.id === latestAssistantId}
                  onFollowUp={onSend}
                  onCreateVersion={() => onCreateVersion(message)}
                  onResultAction={onResultAction}
                />
              ))}
            </div>
            <div ref={bottomRef} className="h-8" />
          </div>
        )}
      </div>

      {!guideVisible ? <div className="shrink-0 bg-[#fbfbfa]/94 px-3 pb-3 pt-2 backdrop-blur-md md:px-6 md:pb-5">
        <div className="mx-auto max-w-[820px]">
          <div className="composer-shadow rounded-[calc(var(--brain-radius)+4px)] border border-[#d4d2cc] bg-[#fefefd] p-2 focus-within:border-[#99958d]">
            {attachments.length ? (
              <div className="flex gap-2 overflow-x-auto px-2 pb-1 pt-1">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="group/attachment flex min-w-0 max-w-56 shrink-0 items-center gap-2 rounded-lg border border-[#e3e1dc] bg-[#f7f6f3] px-2.5 py-1.5">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white text-[#6f6b65]"><ImageIcon size={12} /></span>
                    <span className="min-w-0"><span className="block truncate text-[9px] font-medium text-[#4b4844]">{attachment.name}</span><span className="block text-[8px] text-[#9a968f]">{Math.ceil(attachment.size / 1024)} KB</span></span>
                    <button aria-label={`Treu ${attachment.name}`} className="ml-auto grid size-5 shrink-0 place-items-center rounded-md text-[#918d86] hover:bg-white hover:text-[#413e39]" onClick={() => onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))}><X size={10} /></button>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              aria-label="Missatge"
              className="max-h-40 min-h-14 w-full resize-none bg-transparent px-2.5 py-2.5 text-[13px] leading-6 text-[#292725] outline-none placeholder:text-[#a19e98]"
              placeholder={project ? `Escriu a ${preferences.assistantName}…` : "Crea un projecte per començar…"}
              rows={1}
              value={prompt}
              disabled={!project}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!sending && prompt.trim()) onSend();
                }
              }}
            />
            <div className="flex items-center justify-between gap-3 px-1 pb-0.5">
              <div className="flex min-w-0 items-center gap-1">
                {showAdvancedControls ? <select aria-label="Mode del torn" className="composer-select" value={composerMode} onChange={(event) => onComposerModeChange(event.target.value as ComposerMode)} disabled={sending}>
                  {manifest.composer.modes.includes("agent") ? <option value="agent">Agent</option> : null}
                  {manifest.composer.modes.includes("plan") ? <option value="plan">Pla</option> : null}
                  {manifest.composer.modes.includes("ask") ? <option value="ask">Pregunta</option> : null}
                </select> : null}
                {showAdvancedControls && manifest.composer.modelSelection ? (
                  <select aria-label="Model" className="composer-select hidden sm:block" value={composerModel ?? ""} onChange={(event) => onComposerModelChange(event.target.value || null)} disabled={sending || runtimeStatus.models.length === 0}>
                    <option value="">{runtimeStatus.model ?? "Model automàtic"}</option>
                    {runtimeStatus.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                ) : null}
                {showAdvancedControls && manifest.composer.modelSelection && runtimeStatus.mode === "codex" ? (
                  <select aria-label="Nivell de raonament" className="composer-select hidden sm:block" value={composerEffort ?? ""} onChange={(event) => onComposerEffortChange((event.target.value || null) as RuntimeReasoningEffort | null)} disabled={sending}>
                    <option value="">Automàtic</option>
                    {effortOptions.map((effort) => <option key={effort} value={effort}>{effortLabels[effort]}</option>)}
                  </select>
                ) : null}
                <button aria-label="Obre les accions guiades" className={`composer-tool ${guidedActionsOpen ? "composer-tool-active" : ""}`} disabled={sending || !project} onClick={() => setGuidedActionsOpen((current) => !current)}><MagicWand size={12} /><span className="hidden lg:inline">Accions</span></button>
                {showAdvancedControls && manifest.composer.skills && runtimeStatus.skills.length ? (
                  <label className="relative hidden sm:block">
                    <Wrench size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[#77736d]" />
                    <select aria-label="Skill" className="composer-select pl-6" value={selectedSkill ?? ""} onChange={(event) => onSelectedSkillChange(event.target.value || null)} disabled={sending}>
                      <option value="">Sense skill</option>
                      {runtimeStatus.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.label}</option>)}
                    </select>
                  </label>
                ) : null}
                {canUseWeb ? <button aria-label="Activa o desactiva la cerca web" aria-pressed={webSearch} className={`composer-tool ${webSearch ? "composer-tool-active" : ""}`} disabled={sending} onClick={() => onWebSearchChange(!webSearch)}><Globe size={12} /><span className="hidden lg:inline">Web</span></button> : null}
                {canGenerateImages ? <button aria-label="Activa o desactiva la generació d’imatges" aria-pressed={imageGeneration} className={`composer-tool ${imageGeneration ? "composer-tool-active" : ""}`} disabled={sending} onClick={() => onImageGenerationChange(!imageGeneration)}><ImagesSquare size={13} /><span className="hidden lg:inline">Imatge</span></button> : null}
                {canAttachImages ? <><input ref={fileInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => void addImages(event.target.files)} /><button aria-label="Adjunta imatges" className="composer-tool" disabled={sending || attachments.length >= 3} onClick={() => fileInputRef.current?.click()}><Paperclip size={13} /></button></> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-[8px] text-[#aaa69f] md:block">↵ envia · ⇧↵ línia</span>
                {sending ? (
                  <button aria-label="Aturar resposta" className="grid size-7 place-items-center rounded-lg bg-[#292725] text-white transition active:scale-95" onClick={onStop}><Stop size={11} weight="fill" /></button>
                ) : (
                  <button aria-label="Enviar missatge" className="grid size-7 place-items-center rounded-lg bg-[var(--brain-accent)] text-[var(--brain-contrast)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30" disabled={!project || !prompt.trim()} onClick={() => onSend()}><ArrowUp size={13} weight="bold" /></button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-2 flex h-3 items-center justify-center gap-1.5 text-[9px] text-[#6f6c67]">
            {sending ? <><SpinnerGap size={10} className="motion-safe:animate-spin" />{preferences.assistantName} està treballant</> : runtimeStatus.ready ? <><CheckCircle size={10} />{showAdvancedControls ? "Runtime preparat" : "Preparat per treballar"}</> : null}
          </div>
        </div>
      </div> : null}
    </main>
  );
}
