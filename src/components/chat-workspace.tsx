"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretRight,
  ChatCircleDots,
  Check,
  CheckCircle,
  Copy,
  DownloadSimple,
  FolderOpen,
  File as FileIcon,
  Globe,
  Image as ImageIcon,
  ImagesSquare,
  List,
  Paperclip,
  Plus,
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
import { MarkdownMessage } from "@/components/markdown-message";
import type { ApprovalDecision, ApprovalItem, ChatInputAttachment, ChatMessage, ComposerMode } from "@/lib/chat-contract";
import type { BrainManifest, BrainPreferences, BrainWindowId } from "@/config/brain";
import type { RuntimeReasoningEffort, RuntimeStatus } from "@/lib/runtime-status";
import { isStandaloneProject, type WorkbenchProject, type WorkbenchThread } from "@/workbench/types";
import { TurnActivity } from "@/components/turn-activity";
import { TurnArtifactCard } from "@/components/turn-artifact-card";
import { DocumentPublicationCard } from "@/components/document-publication-card";
import type { StagedComposerDocument } from "@/ui/document-ui-adapter";
import type { DocumentPublicationDraft } from "@/ui/publication-ui-adapter";

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
  documents: StagedComposerDocument[];
  publications: DocumentPublicationDraft[];
  documentUploading: boolean;
  sending: boolean;
  runtimeStatus: RuntimeStatus;
  networkOnline: boolean;
  onRetryRuntime: () => void;
  onPromptChange: (value: string) => void;
  onComposerModeChange: (value: ComposerMode) => void;
  onComposerModelChange: (value: string | null) => void;
  onComposerEffortChange: (value: RuntimeReasoningEffort | null) => void;
  onWebSearchChange: (value: boolean) => void;
  onImageGenerationChange: (value: boolean) => void;
  onSelectedSkillChange: (value: string | null) => void;
  onAttachmentsChange: (value: ChatInputAttachment[]) => void;
  onDocumentsChange: (value: StagedComposerDocument[]) => void;
  onAddDocuments: (files: File[]) => Promise<void>;
  onFreezePublication: (draftId: string, targetRelativePath: string) => Promise<void>;
  onDecidePublication: (draftId: string, action: "confirm" | "decline") => Promise<void>;
  onComposerNotice: (message: string) => void;
  onSend: (message?: string, displayMessage?: string) => void;
  onStop: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenCustomization: () => void;
  activeSideWindow: Exclude<BrainWindowId, "chat" | "runtime"> | null;
  canInspect: boolean;
  onInspectMessage: (messageId: string) => void;
  onResolveApproval: (
    messageId: string,
    approval: ApprovalItem,
    decision: ApprovalDecision,
  ) => Promise<void>;
  onCreateVersion: (message: ChatMessage) => void;
  onResultAction: (message: ChatMessage, action: "approved" | "pending" | "undo") => Promise<void>;
  showAdvancedControls: boolean;
};

type ComposerPickerOption = {
  value: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
};

function ComposerPicker({
  ariaLabel,
  value,
  valueLabel,
  options,
  open,
  placement,
  className,
  disabled = false,
  onOpenChange,
  onSelect,
}: {
  ariaLabel: string;
  value: string;
  valueLabel: string;
  options: ComposerPickerOption[];
  open: boolean;
  placement: "above" | "below";
  className?: string;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
}) {
  return (
    <div className={`composer-picker relative shrink-0 ${className ?? ""}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`composer-picker-button ${open ? "composer-picker-button-active" : ""}`}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        <span className="max-w-32 truncate">{valueLabel}</span>
        <CaretDown size={11} className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={ariaLabel}
          className={`menu-enter absolute z-40 w-56 rounded-[20px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-1.5 shadow-[var(--shadow-popover)] ${placement === "above" ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`flex min-h-10 w-full items-center gap-2.5 rounded-[14px] px-3 py-2 text-left transition-colors ${selected ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"}`}
                onClick={() => {
                  onSelect(option.value);
                  onOpenChange(false);
                }}
              >
                {option.icon ? <span className="grid size-5 shrink-0 place-items-center text-[var(--text-subtle)]">{option.icon}</span> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">{option.label}</span>
                  {option.detail ? <span className="mt-0.5 block truncate text-[10px] text-[var(--text-subtle)]">{option.detail}</span> : null}
                </span>
                <Check size={13} weight="bold" className={selected ? "opacity-100" : "opacity-0"} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

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
    link.download = `resultado-aibrain-${message.createdAt.slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const review = async () => {
    setBusy(true);
    try { await onResultAction(approved ? "pending" : "approved"); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-0.5 text-[var(--text-muted)]">
      <button type="button" title={approved ? "Resultado aprobado" : "Aprobar resultado"} aria-label={approved ? "Resultado aprobado" : "Aprobar resultado"} disabled={busy} aria-pressed={approved} className={`result-action ${approved ? "text-[var(--positive)]" : ""}`} onClick={() => void review()}><CheckCircle size={14} weight={approved ? "fill" : "regular"} /></button>
      <button type="button" title="Copiar resultado" aria-label="Copiar resultado" className="result-action" onClick={() => void copyResult()}><Copy size={14} />{copied ? <span className="ml-1 text-[9px]">Copiado</span> : null}</button>
      <button type="button" title="Descargar resultado" aria-label="Descargar resultado" className="result-action" onClick={downloadResult}><DownloadSimple size={14} /></button>
      <button type="button" title="Crear una nueva versión" aria-label="Crear una nueva versión" className="result-action" onClick={onCreateVersion}><GitBranch size={14} /></button>
      {message.diff ? <button type="button" title="Deshacer cambios" aria-label="Deshacer cambios" className="result-action text-[var(--danger)]" onClick={() => void onResultAction("undo")}><ArrowUp size={14} className="rotate-[-90deg]" /></button> : null}
    </div>
  );
}

function AssistantMessage({
  message,
  showActivity,
  onInspect,
  onResolveApproval,
  canInspect,
  showInlineDiff,
  onCreateVersion,
  onResultAction,
  publications,
  onFreezePublication,
  onDecidePublication,
}: {
  message: ChatMessage;
  showActivity: boolean;
  onInspect: () => void;
  onResolveApproval: (approval: ApprovalItem, decision: ApprovalDecision) => void;
  canInspect: boolean;
  showInlineDiff: boolean;
  onCreateVersion: () => void;
  onResultAction: (message: ChatMessage, action: "approved" | "pending" | "undo") => Promise<void>;
  publications: DocumentPublicationDraft[];
  onFreezePublication: (draftId: string, targetRelativePath: string) => Promise<void>;
  onDecidePublication: (draftId: string, action: "confirm" | "decline") => Promise<void>;
}) {
  const hasDetails = message.activity.length > 0 || message.plan.length > 0 || message.approvals.length > 0 || Boolean(message.diff);
  const hasExecution = message.activity.length > 0 || message.plan.length > 0;

  return (
    <article className="message-enter group">
      {showActivity ? (
        <TurnActivity message={message} showDiff={showInlineDiff} onResolveApproval={onResolveApproval} />
      ) : null}

      {message.status === "streaming" && !message.content && !hasExecution ? (
        <div className="flex items-center gap-2 py-1 text-[16px] leading-5 text-[var(--text-muted)]" aria-label="Pensando"><SpinnerGap size={14} className="motion-safe:animate-spin" /><span className="activity-shimmer">Pensando…</span></div>
      ) : message.content ? (
        <div className="mt-4 max-w-[76ch] text-[16px] leading-7 text-[var(--text)]" aria-live={message.status === "streaming" ? "polite" : undefined} aria-atomic="false">
          <MarkdownMessage>{message.content}</MarkdownMessage>
          {message.status === "streaming" ? <span className="stream-caret ml-0.5 inline-block h-4 w-[2px] bg-[var(--brain-accent)] align-middle" /> : null}
        </div>
      ) : null}

      {message.status === "error" ? (
        <div className="mt-3 flex max-w-xl items-start gap-2 rounded-[var(--brain-radius)] border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2.5 text-[11px] text-[var(--danger)]" role="alert">
          <WarningCircle size={15} className="mt-0.5 shrink-0" />
          <span>No se ha podido completar esta respuesta. Inténtalo de nuevo.</span>
        </div>
      ) : null}

      {message.status === "stopped" ? <p className="mt-3 text-[10px] text-[var(--text-muted)]">Respuesta detenida.</p> : null}

      {message.artifacts.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {message.artifacts.map((artifact) => (
            <TurnArtifactCard key={artifact.id} artifact={artifact} />
          ))}
        </div>
      ) : null}

      {publications.map((draft) => (
        <DocumentPublicationCard key={draft.id} draft={draft} onFreeze={onFreezePublication} onDecide={onDecidePublication} />
      ))}

      {message.status === "complete" && message.content ? <ResultActions message={message} onCreateVersion={onCreateVersion} onResultAction={(action) => onResultAction(message, action)} /> : null}

      {hasDetails && canInspect ? (
        <button className="mt-2 flex min-h-9 items-center gap-1.5 rounded-md py-1 text-[10px] font-medium text-[var(--text-muted)] transition hover:text-[var(--text)]" onClick={onInspect}>
          <List size={12} />
          Revisar cambios
        </button>
      ) : null}
    </article>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <article className="message-enter flex justify-end">
      <div className="max-w-[86%] rounded-[22px] bg-[var(--user-message)] px-4 py-2.5 text-[16px] leading-6 text-[var(--user-message-text)] md:max-w-[70%]">
        {message.attachments.length ? (
          <div className="mb-2 flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((attachment) => (
              <span key={attachment.id} className="flex max-w-52 items-center gap-1.5 rounded-md bg-[var(--surface-raised)]/70 px-2 py-1 text-[9px] text-[var(--text)]">
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
  documents,
  publications,
  documentUploading,
  sending,
  runtimeStatus,
  networkOnline,
  onRetryRuntime,
  onPromptChange,
  onComposerModeChange,
  onComposerModelChange,
  onComposerEffortChange,
  onWebSearchChange,
  onImageGenerationChange,
  onSelectedSkillChange,
  onAttachmentsChange,
  onDocumentsChange,
  onAddDocuments,
  onFreezePublication,
  onDecidePublication,
  onComposerNotice,
  onSend,
  onStop,
  sidebarOpen,
  onToggleSidebar,
  onOpenCustomization,
  activeSideWindow,
  canInspect,
  onInspectMessage,
  onResolveApproval,
  onCreateVersion,
  onResultAction,
  showAdvancedControls,
}: ChatWorkspaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [guidedActionsOpen, setGuidedActionsOpen] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [composerPickerOpen, setComposerPickerOpen] = useState<"mode" | "model" | "effort" | "skill" | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const standaloneConversation = Boolean(project && isStandaloneProject(project));

  useEffect(() => {
    if (!shouldStickToBottomRef.current && !sending) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [sending, thread?.messages]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.id]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
  }, [prompt]);

  const hasMessages = Boolean(thread?.messages.length);
  const guideVisible = guidedActionsOpen;
  const canAttachImages = manifest.composer.images && (runtimeStatus.mode === "demo" || runtimeStatus.capabilities.imageInput);
  const canAttachDocuments = runtimeStatus.mode === "codex";
  const canUseWeb = manifest.composer.webSearch && (runtimeStatus.mode === "demo" || runtimeStatus.capabilities.webSearch);
  const canGenerateImages = manifest.composer.imageGeneration && (runtimeStatus.mode === "demo" || runtimeStatus.capabilities.imageGeneration);
  const runtimeReady = networkOnline && (runtimeStatus.mode === "demo" || runtimeStatus.ready);
  const selectedModelOption = runtimeStatus.models.find((model) => model.id === composerModel) ??
    runtimeStatus.models.find((model) => model.isDefault) ?? runtimeStatus.models[0] ?? null;
  const effortOptions = selectedModelOption?.supportedReasoningEfforts.length
    ? selectedModelOption.supportedReasoningEfforts
    : (["low", "medium", "high"] satisfies RuntimeReasoningEffort[]);
  const effortLabels: Record<RuntimeReasoningEffort, string> = {
    none: "Sin razonamiento",
    minimal: "Mínimo",
    low: "Rápido",
    medium: "Equilibrado",
    high: "Profundo",
    xhigh: "Muy profundo",
    max: "Máximo",
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

  useEffect(() => {
    if (!composerMenuOpen && !composerPickerOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (composerShellRef.current?.contains(event.target as Node)) return;
      setComposerMenuOpen(false);
      setComposerPickerOpen(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setComposerMenuOpen(false);
      setComposerPickerOpen(null);
      composerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [composerMenuOpen, composerPickerOpen]);

  const addImages = async (files: FileList | File[] | null) => {
    if (!files || !canAttachImages) return;
    const available = Math.max(0, 3 - attachments.length);
    const selected = Array.from(files).slice(0, available);
    if (files.length > available) onComposerNotice("Puedes adjuntar un máximo de 3 imágenes por mensaje.");
    const next: ChatInputAttachment[] = [];
    for (const file of selected) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        onComposerNotice(`${file.name} no es una imagen compatible.`);
        continue;
      }
      if (file.size > 2_000_000) {
        onComposerNotice(`${file.name} supera el límite de 2 MB.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("invalid"));
        reader.onerror = () => reject(reader.error ?? new Error("read"));
        reader.readAsDataURL(file);
      }).catch(() => "");
      if (!dataUrl) {
        onComposerNotice(`No se ha podido leer ${file.name}.`);
        continue;
      }
      next.push({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size, dataUrl });
    }
    if (next.length) onAttachmentsChange([...attachments, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const images: File[] = [];
    const documentFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (canAttachImages && /^image\/(png|jpeg|webp|gif)$/.test(file.type) && file.size <= 2_000_000) {
        images.push(file);
      } else if (canAttachDocuments) {
        documentFiles.push(file);
      } else {
        onComposerNotice(`${file.name} no es compatible con este runtime.`);
      }
    }
    if (images.length) await addImages(images);
    if (documentFiles.length) await onAddDocuments(documentFiles);
  };

  const updateScrollState = () => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    shouldStickToBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom);
  };

  const jumpToBottom = () => {
    shouldStickToBottomRef.current = true;
    setShowJumpToBottom(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  return (
    <main className="workbench-main relative flex min-w-0 flex-1 flex-col bg-[var(--surface)]">
      <header className="flex h-[52px] shrink-0 items-center justify-between bg-[var(--header)] px-2 md:px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button aria-label="Mostrar u ocultar la barra lateral" aria-expanded={sidebarOpen} className="touch-target rounded-lg p-2 text-[var(--text-subtle)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] md:hidden" onClick={onToggleSidebar}>
            <SidebarSimple size={17} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1">
            {!standaloneConversation ? <FolderOpen size={14} className="hidden shrink-0 text-[var(--text-subtle)] sm:block" weight="fill" /> : <ChatCircleDots size={14} className="hidden shrink-0 text-[var(--text-subtle)] sm:block" />}
            {!standaloneConversation ? <span className="hidden max-w-36 truncate text-[12px] font-medium text-[var(--text-secondary)] sm:block">{project?.name ?? "Proyecto"}</span> : null}
            {thread && !standaloneConversation ? <CaretRight size={11} className="hidden shrink-0 text-[var(--text-subtle)] sm:block" /> : null}
            <span className="max-w-[52vw] truncate text-[13px] font-semibold text-[var(--text)] sm:max-w-72">{thread?.title ?? (project ? "Nueva conversación" : "Inicio")}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button aria-label="Abrir preferencias" className="touch-target rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onOpenCustomization}>
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto" onScroll={updateScrollState}>
        {!hydrated ? (
          <div className="mx-auto max-w-3xl px-6 py-14">
            <div className="mb-8 h-7 w-48 rounded-md bg-[var(--surface-muted)] motion-safe:animate-pulse" />
            <div className="space-y-4"><div className="h-20 rounded-xl bg-[var(--surface-muted)] motion-safe:animate-pulse" /><div className="h-14 rounded-xl bg-[var(--surface-hover)] motion-safe:animate-pulse" /></div>
          </div>
        ) : guideVisible ? (
          <GuidedActions projectId={project?.id ?? null} projectName={project?.name ?? "Proyecto"} onCancel={() => setGuidedActionsOpen(false)} onStart={(message, summary) => { setGuidedActionsOpen(false); onSend(message, summary); }} />
        ) : hasMessages ? (
          <div className="mx-auto w-full max-w-[768px] px-5 py-3 md:px-8">
            <div className={preferences.density === "compact" ? "space-y-6" : "space-y-8"}>
              {thread?.messages.map((message) => message.role === "user" ? (
                <UserMessage key={message.id} message={message} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  showActivity={preferences.showActivityPanel}
                  onInspect={() => onInspectMessage(message.id)}
                  onResolveApproval={(approval, decision) => void onResolveApproval(message.id, approval, decision)}
                  canInspect={canInspect}
                  showInlineDiff={activeSideWindow !== "inspector"}
                  onCreateVersion={() => onCreateVersion(message)}
                  onResultAction={onResultAction}
                  publications={publications.filter((draft) => draft.turnId === message.id && draft.threadId === thread.id)}
                  onFreezePublication={onFreezePublication}
                  onDecidePublication={onDecidePublication}
                />
              ))}
            </div>
            <div ref={bottomRef} className="h-8" />
          </div>
        ) : (
          <section className="mx-auto flex min-h-full w-full max-w-[768px] flex-col items-center justify-start px-5 pb-14 pt-[clamp(8rem,26vh,12rem)] text-center md:px-8">
            <h1 className="text-balance text-[24px] font-normal leading-7 tracking-[-.02em] text-[var(--text)]">¿En qué trabajamos?</h1>
            <div className="mt-[clamp(14rem,27vh,16rem)] flex w-full flex-wrap justify-center gap-1.5 md:mt-[clamp(15rem,27vh,17rem)]">
              {[
                ["Analizar información", "Encuentra riesgos, claves y próximos pasos"],
                ["Crear un documento", "Prepara un primer borrador listo para revisar"],
                ["Resumir contenido", "Quédate con decisiones, fechas y acciones"],
              ].map(([label, detail]) => (
                <button key={label} type="button" title={detail} className="min-h-9 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-[10px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text)]" onClick={() => { onPromptChange(`${label}: `); }}>
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className={`${hasMessages ? "relative shrink-0 bg-[var(--surface)]/94 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md md:pb-6" : "!absolute inset-x-0 top-[clamp(15.6rem,42vh,21.25rem)] z-10"} px-3 md:px-6`}>
        {showJumpToBottom ? <div className="mb-2 flex justify-center md:absolute md:left-1/2 md:top-0 md:z-20 md:mb-0 md:-translate-x-1/2 md:-translate-y-full"><button type="button" className="flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[11px] font-medium text-[var(--text)] shadow-[var(--shadow-sm)]" onClick={jumpToBottom}><ArrowDown size={13} />Volver al final</button></div> : null}
        <div className={`relative mx-auto ${hasMessages ? "max-w-[610px]" : "max-w-[768px]"}`}>
          {!networkOnline ? <div className={`menu-enter flex min-h-11 items-center justify-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-2.5 text-center text-[12px] text-[var(--text-secondary)] shadow-[var(--shadow-popover)] ${hasMessages ? "mb-2" : "absolute inset-x-0 bottom-full mb-2"}`} role="alert"><WarningCircle size={15} className="shrink-0 text-[var(--text-subtle)]" />Sin conexión. El historial sigue disponible y no se enviará nada.</div> : runtimeStatus.codex === "checking" ? <div className={`flex min-h-9 items-center justify-center gap-2 text-center text-[11px] text-[var(--text-secondary)] ${hasMessages ? "mb-2" : "absolute inset-x-0 bottom-full mb-2"}`} role="status"><span className="size-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text-secondary)] motion-reduce:animate-none" aria-hidden="true" />Conectando con el servicio…</div> : runtimeStatus.mode === "codex" && !runtimeStatus.ready ? <div className={`menu-enter flex min-h-11 flex-wrap items-center justify-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-2.5 text-center text-[12px] text-[var(--text-secondary)] shadow-[var(--shadow-popover)] ${hasMessages ? "mb-2" : "absolute inset-x-0 bottom-full mb-2"}`} role="alert"><WarningCircle size={15} className="shrink-0 text-[var(--text-subtle)]" /><span>El servicio no está disponible. Puedes revisar el historial.</span><button type="button" className="min-h-8 rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-[11px] font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" onClick={onRetryRuntime}>Reintentar</button></div> : null}
          <div
            ref={composerShellRef}
            data-testid="composer"
            className={`composer-shadow relative rounded-[28px] border bg-[var(--surface-raised)] p-2 ${hasMessages && !attachments.length && !documents.length ? "composer-compact" : ""} ${hasMessages ? "" : "min-h-[128px]"} ${dragActive ? "border-[var(--brain-accent)] ring-2 ring-[var(--brain-accent-soft)]" : "border-transparent"}`}
            onDragEnter={(event) => { event.preventDefault(); if ((canAttachImages || canAttachDocuments) && !sending && !documentUploading) setDragActive(true); }}
            onDragOver={(event) => { event.preventDefault(); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
            onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!sending && !documentUploading) void addFiles(event.dataTransfer.files); }}
          >
            {dragActive ? <div className="pointer-events-none absolute inset-1 z-20 grid place-items-center rounded-[var(--brain-radius)] bg-[var(--surface-raised)]/95 text-[12px] font-semibold text-[var(--brain-accent)]">Suelta los archivos para adjuntarlos</div> : null}
            {composerMenuOpen ? (
              <div role="menu" aria-label="Añadir al mensaje" className={`absolute inset-x-0 z-30 rounded-[20px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-2 shadow-[var(--shadow-lg)] ${hasMessages ? "bottom-full mb-2" : "top-full mt-2"}`}>
                {(canAttachImages || canAttachDocuments) ? <button role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-hover)]" disabled={sending || documentUploading} onClick={() => { setComposerMenuOpen(false); fileInputRef.current?.click(); }}><Paperclip size={17} />Adjuntar archivos</button> : null}
                {canUseWeb ? <button role="menuitemcheckbox" aria-checked={webSearch} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-hover)]" disabled={sending} onClick={() => onWebSearchChange(!webSearch)}><Globe size={17} />Buscar en la web<span className="ml-auto text-[11px] text-[var(--text-subtle)]">{webSearch ? "Activado" : ""}</span></button> : null}
                {canGenerateImages ? <button role="menuitemcheckbox" aria-checked={imageGeneration} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-hover)]" disabled={sending} onClick={() => onImageGenerationChange(!imageGeneration)}><ImagesSquare size={17} />Crear imagen<span className="ml-auto text-[11px] text-[var(--text-subtle)]">{imageGeneration ? "Activado" : ""}</span></button> : null}
                <button role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-hover)]" disabled={sending || !project} onClick={() => { setComposerMenuOpen(false); setGuidedActionsOpen(true); }}><MagicWand size={17} />Acciones guiadas</button>
              </div>
            ) : null}
            {attachments.length || documents.length ? (
              <div className="flex gap-2 overflow-x-auto px-2 pb-1 pt-1">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="group/attachment flex min-w-0 max-w-56 shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1.5">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--surface-raised)] text-[var(--text-muted)]"><ImageIcon size={12} /></span>
                    <span className="min-w-0"><span className="block truncate text-[9px] font-medium text-[var(--text-secondary)]">{attachment.name}</span><span className="block text-[8px] text-[var(--text-subtle)]">Lista · {Math.ceil(attachment.size / 1024)} KB</span></span>
                    <button type="button" aria-label={`Quitar ${attachment.name}`} className="ml-auto grid size-5 shrink-0 place-items-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]" onClick={() => onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))}><X size={10} /></button>
                  </div>
                ))}
                {documents.map((document) => (
                  <div key={document.uploadId} className={`group/attachment flex min-w-0 max-w-64 shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 ${document.status === "error" ? "border-[var(--danger)] bg-[var(--danger-soft)]" : "border-[var(--border)] bg-[var(--surface-muted)]"}`}>
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--surface-raised)] text-[var(--text-muted)]">{document.status === "uploading" ? <SpinnerGap size={12} className="motion-safe:animate-spin" /> : <FileIcon size={12} />}</span>
                    <span className="min-w-0"><span className="block truncate text-[9px] font-medium text-[var(--text-secondary)]">{document.name}</span><span className={`block truncate text-[8px] ${document.status === "error" ? "text-[var(--danger)]" : "text-[var(--text-subtle)]"}`}>{document.status === "uploading" ? "Preparando vista previa…" : document.status === "error" ? document.error : `Lista · ${document.kind.toUpperCase()}${document.pages ? ` · ${document.pages} pág.` : ""}`}</span></span>
                    {document.status === "ready" && document.previewFiles[0] ? <a href={document.previewFiles[0].url} target="_blank" rel="noreferrer" className="text-[8px] font-semibold text-[var(--brain-accent)] hover:underline">Abrir</a> : null}
                    <button type="button" aria-label={`Quitar ${document.name}`} className="ml-auto grid size-5 shrink-0 place-items-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]" onClick={() => onDocumentsChange(documents.filter((item) => item.uploadId !== document.uploadId))}><X size={10} /></button>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              ref={composerRef}
              aria-label="Mensaje"
              className="composer-textarea max-h-52 min-h-14 w-full resize-none overflow-y-auto bg-transparent px-2.5 py-2.5 text-[16px] leading-[26px] text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]"
              placeholder={project ? `Escribe a ${preferences.assistantName}…` : "Crea un proyecto para empezar…"}
              rows={1}
              value={prompt}
              disabled={!project}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!sending && !documentUploading && prompt.trim() && runtimeReady) {
                    shouldStickToBottomRef.current = true;
                    onSend();
                  }
                }
              }}
            />
            <div className="composer-controls flex items-center justify-between gap-3 px-1 pb-0.5">
              <div className="composer-controls-start flex min-w-0 items-center gap-1 overflow-visible">
                <button aria-label="Añadir al mensaje" aria-expanded={composerMenuOpen} className={`composer-add-button composer-tool !grid !size-8 !place-items-center !rounded-full ${composerMenuOpen ? "composer-tool-active" : ""}`} disabled={sending || !project} onClick={() => { setComposerPickerOpen(null); setComposerMenuOpen((current) => !current); }}><Plus size={15} /></button>
                {showAdvancedControls ? (
                  <ComposerPicker
                    ariaLabel="Modo del turno"
                    value={composerMode}
                    valueLabel={{ agent: "Agent", plan: "Plan", ask: "Pregunta" }[composerMode]}
                    options={[
                      ...(manifest.composer.modes.includes("agent") ? [{ value: "agent", label: "Agent", detail: "Ejecuta el trabajo" }] : []),
                      ...(manifest.composer.modes.includes("plan") ? [{ value: "plan", label: "Plan", detail: "Prepara los pasos" }] : []),
                      ...(manifest.composer.modes.includes("ask") ? [{ value: "ask", label: "Pregunta", detail: "Responde sin ejecutar" }] : []),
                    ]}
                    open={composerPickerOpen === "mode"}
                    placement={hasMessages ? "above" : "below"}
                    disabled={sending}
                    onOpenChange={(open) => { setComposerMenuOpen(false); setComposerPickerOpen(open ? "mode" : null); }}
                    onSelect={(value) => onComposerModeChange(value as ComposerMode)}
                  />
                ) : null}
                {showAdvancedControls && manifest.composer.skills && runtimeStatus.skills.length ? (
                  <ComposerPicker
                    ariaLabel="Skill"
                    value={selectedSkill ?? ""}
                    valueLabel={runtimeStatus.skills.find((skill) => skill.id === selectedSkill)?.label ?? "Sin skill"}
                    options={[{ value: "", label: "Sin skill" }, ...runtimeStatus.skills.map((skill) => ({ value: skill.id, label: skill.label, icon: <Wrench size={12} /> }))]}
                    open={composerPickerOpen === "skill"}
                    placement={hasMessages ? "above" : "below"}
                    className="hidden sm:block"
                    disabled={sending}
                    onOpenChange={(open) => { setComposerMenuOpen(false); setComposerPickerOpen(open ? "skill" : null); }}
                    onSelect={(value) => onSelectedSkillChange(value || null)}
                  />
                ) : null}
                {canAttachImages || canAttachDocuments ? <input ref={fileInputRef} aria-label="Seleccionar archivos para adjuntar" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json" multiple onChange={(event) => void addFiles(event.target.files)} /> : null}
              </div>
              <div className="composer-controls-end flex shrink-0 items-center gap-2">
                {showAdvancedControls && manifest.composer.modelSelection ? (
                  <ComposerPicker
                    ariaLabel="Modelo"
                    value={composerModel ?? ""}
                    valueLabel={selectedModelOption?.label ?? runtimeStatus.model ?? "Modelo automático"}
                    options={[
                      { value: "", label: runtimeStatus.model ?? "Modelo automático", detail: "Predeterminado" },
                      ...runtimeStatus.models.map((model) => ({ value: model.id, label: model.label, detail: model.isDefault ? "Predeterminado" : undefined })),
                    ]}
                    open={composerPickerOpen === "model"}
                    placement={hasMessages ? "above" : "below"}
                    className="hidden sm:block"
                    disabled={sending || runtimeStatus.models.length === 0}
                    onOpenChange={(open) => { setComposerMenuOpen(false); setComposerPickerOpen(open ? "model" : null); }}
                    onSelect={(value) => onComposerModelChange(value || null)}
                  />
                ) : null}
                {showAdvancedControls && manifest.composer.modelSelection && runtimeStatus.mode === "codex" ? (
                  <ComposerPicker
                    ariaLabel="Nivel de razonamiento"
                    value={composerEffort ?? ""}
                    valueLabel={composerEffort ? effortLabels[composerEffort] : "Automático"}
                    options={[{ value: "", label: "Automático" }, ...effortOptions.map((effort) => ({ value: effort, label: effortLabels[effort] }))]}
                    open={composerPickerOpen === "effort"}
                    placement={hasMessages ? "above" : "below"}
                    className="hidden sm:block"
                    disabled={sending}
                    onOpenChange={(open) => { setComposerMenuOpen(false); setComposerPickerOpen(open ? "effort" : null); }}
                    onSelect={(value) => onComposerEffortChange((value || null) as RuntimeReasoningEffort | null)}
                  />
                ) : null}
                <span className="composer-hint hidden text-[9px] text-[var(--text-subtle)] md:block">↵ enviar · ⇧↵ nueva línea</span>
                {sending ? (
                  <button aria-label="Detener respuesta" className="grid size-11 place-items-center rounded-xl bg-[var(--text)] text-[var(--surface)] transition active:scale-95 sm:size-8 sm:rounded-full" onClick={onStop}><Stop size={11} weight="fill" /></button>
                ) : (
                  <button aria-label="Enviar mensaje" className="grid size-11 place-items-center rounded-xl bg-[var(--brain-accent)] text-[var(--brain-contrast)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 sm:size-8 sm:rounded-full" disabled={!project || !prompt.trim() || !runtimeReady || documentUploading} onClick={() => { shouldStickToBottomRef.current = true; onSend(); }}><ArrowUp size={13} weight="bold" /></button>
                )}
              </div>
            </div>
          </div>
          <div className={`${hasMessages ? "hidden" : "flex"} mt-2 h-3 items-center justify-center gap-1.5 text-[10px] text-[var(--text-subtle)]`}>
            {sending ? <><SpinnerGap size={11} className="motion-safe:animate-spin" />{preferences.assistantName} está trabajando</> : <span>Comprueba los datos importantes antes de usarlos.</span>}
          </div>
        </div>
      </div>
    </main>
  );
}
