"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  ChatCircleDots,
  Check,
  Copy,
  FolderOpen,
  File as FileIcon,
  Globe,
  Image as ImageIcon,
  ImagesSquare,
  Paperclip,
  Plus,
  MagicWand,
  PencilSimple,
  SidebarSimple,
  SpinnerGap,
  Stop,
  WarningCircle,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { GuidedActions } from "@/components/guided-actions";
import { MarkdownMessage } from "@/components/markdown-message";
import { ThinkingOrb } from "thinking-orbs";
import type { ApprovalDecision, ApprovalItem, ChatInputAttachment, ChatMessage } from "@/lib/chat-contract";
import type { BrainManifest, BrainPreferences } from "@/config/brain";
import type { RuntimeReasoningEffort, RuntimeStatus } from "@/lib/runtime-status";
import { isStandaloneProject, type WorkbenchProject, type WorkbenchThread } from "@/workbench/types";
import { TurnActivity } from "@/components/turn-activity";
import { TurnArtifactCard } from "@/components/turn-artifact-card";
import { DocumentPublicationCard } from "@/components/document-publication-card";
import { TurnSourceChips } from "@/components/turn-sources";
import { VoiceDictationControl } from "@/components/voice-controls";
import { StreamRecoveryBanner } from "@/components/stream-recovery-banner";
import type { StagedComposerDocument } from "@/ui/document-ui-adapter";
import type { DocumentPublicationDraft } from "@/ui/publication-ui-adapter";
import type { ManagedAppActionDescriptor } from "@/ui/codex-managed-app-ui";
import { managedAppActionKey } from "@/ui/codex-managed-app-ui";

type ChatWorkspaceProps = {
  manifest: BrainManifest;
  preferences: BrainPreferences;
  project: WorkbenchProject | null;
  thread: WorkbenchThread | null;
  hydrated: boolean;
  prompt: string;
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
  stopping: boolean;
  runtimeStatus: RuntimeStatus;
  appPolicy: { webSearch: boolean; imageGeneration: boolean; skills: boolean };
  networkOnline: boolean;
  streamRecovery: { attempt: number } | null;
  onRetryRuntime: () => void;
  onPromptChange: (value: string) => void;
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
  onOpenProject: () => void;
  onResolveApproval: (
    messageId: string,
    approval: ApprovalItem,
    decision: ApprovalDecision,
  ) => Promise<void>;
  onEditMessage: (message: ChatMessage, content: string) => void;
  managedAppActionEnabled: boolean;
  managedAppApprovalKeys: readonly string[];
  onManagedAppPrepared: (descriptor: ManagedAppActionDescriptor) => void;
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
                  {option.detail ? <span className="mt-0.5 block truncate text-[12px] text-[var(--text-subtle)]">{option.detail}</span> : null}
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

function ResultActions({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = message.content;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copiedWithFallback = document.execCommand("copy");
      textarea.remove();
      if (!copiedWithFallback) return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-0.5 text-[var(--text-muted)]">
      <button type="button" title="Copiar" aria-label="Copiar" className="result-action" onClick={() => void copyResult()}><Copy size={14} />{copied ? <span className="ml-1 text-[12px]">Copiado</span> : null}</button>
    </div>
  );
}

function AssistantMessage({
  message,
  projectId,
  showActivity,
  onResolveApproval,
  publications,
  onFreezePublication,
  onDecidePublication,
  managedAppAction,
  managedAppApprovalKeys,
}: {
  message: ChatMessage;
  projectId: string | undefined;
  showActivity: boolean;
  onResolveApproval: (approval: ApprovalItem, decision: ApprovalDecision) => void;
  publications: DocumentPublicationDraft[];
  onFreezePublication: (draftId: string, targetRelativePath: string) => Promise<void>;
  onDecidePublication: (draftId: string, action: "confirm" | "decline") => Promise<void>;
  managedAppAction: {
    enabled: boolean;
    threadId: string;
    onPrepared: (descriptor: ManagedAppActionDescriptor) => void;
  } | null;
  managedAppApprovalKeys: readonly string[];
}) {
  const hasExecution = message.activity.length > 0 || message.plan.length > 0;

  return (
    <article className="message-enter group">
      {showActivity || managedAppAction || message.approvals.some((approval) => managedAppApprovalKeys.includes(managedAppActionKey({ ...approval, approvalId: approval.id }))) ? (
        <TurnActivity message={message} projectId={projectId} onResolveApproval={onResolveApproval} managedAppAction={managedAppAction} managedAppApprovalKeys={managedAppApprovalKeys} />
      ) : null}

      {message.status === "streaming" && !message.content && !hasExecution ? (
        <div className="flex items-center gap-2 py-1 text-[16px] leading-5 text-[var(--text-muted)]" role="status">
          <ThinkingOrb state="working" size={20} aria-hidden="true" />
          <span className="activity-shimmer">Pensando…</span>
        </div>
      ) : message.content ? (
        <div className="mt-4 max-w-[76ch] text-[16px] leading-7 text-[var(--text)]" aria-live={message.status === "streaming" ? "polite" : undefined} aria-atomic="false">
          <MarkdownMessage streaming={message.status === "streaming"}>{message.content}</MarkdownMessage>
        </div>
      ) : null}

      <TurnSourceChips sources={message.sources ?? []} />

      {message.status === "error" ? (
        <div className="mt-3 flex max-w-xl items-start gap-2 rounded-[var(--brain-radius)] border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2.5 text-[12px] text-[var(--danger)]" role="alert">
          <WarningCircle size={15} className="mt-0.5 shrink-0" />
          <span>No se ha podido completar esta respuesta. Inténtalo de nuevo.</span>
        </div>
      ) : null}

      {message.status === "stopped" ? <p className="mt-3 text-[12px] text-[var(--text-muted)]">Respuesta detenida.</p> : null}

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

      {message.status === "complete" && message.content ? <ResultActions message={message} /> : null}
    </article>
  );
}

function UserMessage({ message, onEdit }: { message: ChatMessage; onEdit: (content: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(message.content);
  return (
    <article className="message-enter group flex justify-end">
      <div className="max-w-[86%] md:max-w-[70%]">
      <div className="rounded-[22px] bg-[var(--user-message)] px-4 py-2.5 text-[16px] leading-6 text-[var(--user-message-text)]">
        {message.attachments.length ? (
          <div className="mb-2 flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((attachment) => (
              <span key={attachment.id} className="flex max-w-52 items-center gap-1.5 rounded-md bg-[var(--surface-raised)]/70 px-2 py-1 text-[12px] text-[var(--text)]">
                <ImageIcon size={11} /><span className="truncate">{attachment.name}</span>
              </span>
            ))}
          </div>
        ) : null}
        {editing ? (
          <div>
            <label className="sr-only" htmlFor={`edit-${message.id}`}>Editar mensaje</label>
            <textarea id={`edit-${message.id}`} autoFocus value={value} maxLength={32_000} rows={Math.min(8, Math.max(2, value.split("\n").length))} className="w-full min-w-64 resize-y bg-transparent outline-none" onChange={(event) => setValue(event.target.value)} />
            <div className="mt-2 flex justify-end gap-2 text-[12px]">
              <button type="button" className="rounded-full px-3 py-1.5 hover:bg-black/5" onClick={() => { setValue(message.content); setEditing(false); }}>Cancelar</button>
              <button type="button" disabled={!value.trim() || value.trim() === message.content.trim()} className="rounded-full bg-[var(--brain-accent)] px-3 py-1.5 font-semibold text-[var(--brain-contrast)] disabled:opacity-40" onClick={() => { onEdit(value.trim()); setEditing(false); }}>Enviar edición</button>
            </div>
          </div>
        ) : <div>{message.content}</div>}
      </div>
      {!editing && message.attachments.length === 0 ? <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"><button type="button" className="result-action" aria-label="Editar mensaje y crear una rama" title="Editar mensaje" onClick={() => setEditing(true)}><PencilSimple size={14} /></button></div> : null}
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
  stopping,
  runtimeStatus,
  appPolicy,
  networkOnline,
  streamRecovery,
  onRetryRuntime,
  onPromptChange,
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
  onResolveApproval,
  onEditMessage,
  managedAppActionEnabled,
  managedAppApprovalKeys,
  onManagedAppPrepared,
  showAdvancedControls,
}: ChatWorkspaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const composerMeasurementRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [guidedActionsOpen, setGuidedActionsOpen] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [composerPickerOpen, setComposerPickerOpen] = useState<"model" | "effort" | "skill" | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const standaloneConversation = Boolean(project && isStandaloneProject(project));
  const latestAssistantMessageId = thread?.messages.filter((message) => message.role === "assistant").at(-1)?.id ?? null;

  useEffect(() => {
    if (!shouldStickToBottomRef.current && !sending) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [sending, thread?.messages]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.id]);

  const resizeComposer = useCallback(() => {
    const textarea = composerRef.current;
    const measurement = composerMeasurementRef.current;
    if (!textarea || !measurement) return;
    const minHeight = thread?.messages.length ? 44 : 56;
    textarea.style.height = `${Math.min(Math.max(measurement.scrollHeight, minHeight), 192)}px`;
  }, [thread?.messages.length]);

  useLayoutEffect(() => {
    resizeComposer();
  }, [prompt, resizeComposer]);

  useEffect(() => {
    const shell = composerShellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resizeComposer);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [resizeComposer]);

  const hasMessages = Boolean(thread?.messages.length);
  const composerEngaged = Boolean(prompt.trim() || attachments.length || documents.length);
  const guideVisible = guidedActionsOpen;
  const canAttachImages = manifest.composer.images && (runtimeStatus.mode === "demo" || runtimeStatus.capabilities.imageInput);
  const canAttachDocuments = runtimeStatus.mode === "codex";
  const canUseWeb = appPolicy.webSearch && manifest.composer.webSearch && (runtimeStatus.mode === "demo" || runtimeStatus.capabilities.webSearch);
  const canGenerateImages = appPolicy.imageGeneration && manifest.composer.imageGeneration && (runtimeStatus.mode === "demo" || runtimeStatus.capabilities.imageGeneration);
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
        onComposerNotice(`${file.name} no es compatible con el servicio actual.`);
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
      <header data-testid="mobile-app-header" className="mobile-app-header flex h-[52px] shrink-0 items-center justify-between bg-[var(--header)] px-2 md:px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button aria-label="Mostrar u ocultar la barra lateral" aria-expanded={sidebarOpen} className="touch-target rounded-lg p-2 text-[var(--text-subtle)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] md:hidden" onClick={onToggleSidebar}>
            <SidebarSimple size={17} />
          </button>
          <div data-testid="project-breadcrumb" className="flex min-w-0 items-center gap-1.5 px-1 py-1 text-left">
            {!standaloneConversation ? <FolderOpen size={14} className="hidden shrink-0 text-[var(--text-subtle)] sm:block" weight="fill" /> : <ChatCircleDots size={14} className="hidden shrink-0 text-[var(--text-subtle)] sm:block" />}
            <span className="hidden max-w-44 truncate text-[12px] font-medium text-[var(--text-secondary)] sm:block">{standaloneConversation ? "Sin proyecto" : project?.name ?? "Sin proyecto"}</span>
            {thread ? <span className="max-w-[calc(100vw-5.5rem)] truncate text-[13px] font-semibold text-[var(--text)] sm:max-w-72">{thread.title}</span> : <span className="truncate text-[13px] font-semibold text-[var(--text)] sm:hidden">Nueva conversación</span>}
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="mobile-chat-scroll scrollbar-thin min-h-0 flex-1 overflow-y-auto" onScroll={updateScrollState}>
        {!hydrated ? (
          <div className="mx-auto max-w-3xl px-6 py-14">
            <div className="mb-8 h-7 w-48 rounded-md bg-[var(--surface-muted)] motion-safe:animate-pulse" />
            <div className="space-y-4"><div className="h-20 rounded-xl bg-[var(--surface-muted)] motion-safe:animate-pulse" /><div className="h-14 rounded-xl bg-[var(--surface-hover)] motion-safe:animate-pulse" /></div>
          </div>
        ) : guideVisible ? (
          <GuidedActions projectId={project?.id ?? null} projectName={project?.name ?? "Proyecto"} onCancel={() => setGuidedActionsOpen(false)} onWriteDirectly={() => setGuidedActionsOpen(false)} onStart={(message, summary) => { setGuidedActionsOpen(false); onSend(message, summary); }} />
        ) : hasMessages ? (
          <div className="mobile-chat-content mx-auto w-full max-w-[768px] px-5 py-3 md:px-8">
            <div className={preferences.density === "compact" ? "space-y-6" : "space-y-8"}>
              {thread?.messages.map((message) => (
                <div key={message.id} id={`message-${message.id}`} className="scroll-mt-8">
                  {message.role === "user" ? <UserMessage message={message} onEdit={(content) => onEditMessage(message, content)} /> : (
                    <AssistantMessage
                      message={message}
                      projectId={project?.id}
                      showActivity={preferences.showActivityPanel}
                      onResolveApproval={(approval, decision) => void onResolveApproval(message.id, approval, decision)}
                      publications={publications.filter((draft) => draft.turnId === message.id && draft.threadId === thread.id)}
                      onFreezePublication={onFreezePublication}
                      onDecidePublication={onDecidePublication}
                      managedAppApprovalKeys={managedAppApprovalKeys}
                      managedAppAction={managedAppActionEnabled && message.id === latestAssistantMessageId && thread ? {
                        enabled: true,
                        threadId: thread.id,
                        onPrepared: onManagedAppPrepared,
                      } : null}
                    />
                  )}
                </div>
              ))}
            </div>
            <div ref={bottomRef} className="h-8" />
          </div>
        ) : <section className={`chat-empty-state mx-auto flex min-h-full w-full max-w-[768px] flex-col items-center justify-start px-5 pb-14 text-center md:px-8 ${composerEngaged ? "chat-empty-state-engaged" : ""}`} aria-label="Conversación vacía">
          <h1 className="text-balance text-[26px] font-medium leading-8 tracking-[-.025em] text-[var(--text)]">¿En qué trabajamos?</h1>
        </section>}
      </div>

      {!guideVisible ? <div className={`mobile-composer-dock ${hasMessages ? "relative shrink-0 bg-[var(--surface)]/94 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md md:pb-6" : "chat-empty-composer-dock !absolute inset-x-0 z-10"} px-3 md:px-6`}>
        {showJumpToBottom ? <div className="mb-2 flex justify-center md:absolute md:left-1/2 md:top-0 md:z-20 md:mb-0 md:-translate-x-1/2 md:-translate-y-full"><button type="button" className="flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[11px] font-medium text-[var(--text)] shadow-[var(--shadow-sm)]" onClick={jumpToBottom}><ArrowDown size={13} />Volver al final</button></div> : null}
        <div className="relative mx-auto max-w-[768px]">
          {!networkOnline ? <div className={`menu-enter flex min-h-11 items-center justify-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-2.5 text-center text-[12px] text-[var(--text-secondary)] shadow-[var(--shadow-popover)] ${hasMessages ? "mb-2" : "absolute inset-x-0 bottom-full mb-2"}`} role="alert"><WarningCircle size={15} className="shrink-0 text-[var(--text-subtle)]" />Sin conexión. El historial sigue disponible y no se enviará nada.</div> : streamRecovery ? <div className={hasMessages ? "mb-2" : "absolute inset-x-0 bottom-full mb-2"}><StreamRecoveryBanner attempt={streamRecovery.attempt} /></div> : runtimeStatus.codex === "checking" ? <div className={`flex min-h-9 items-center justify-center gap-2 text-center text-[11px] text-[var(--text-secondary)] ${hasMessages ? "mb-2" : "absolute inset-x-0 bottom-full mb-2"}`} role="status"><span className="size-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text-secondary)] motion-reduce:animate-none" aria-hidden="true" />Conectando con el servicio…</div> : runtimeStatus.mode === "codex" && !runtimeStatus.ready ? <div className={`menu-enter flex min-h-11 flex-wrap items-center justify-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-2.5 text-center text-[12px] text-[var(--text-secondary)] shadow-[var(--shadow-popover)] ${hasMessages ? "mb-2" : "absolute inset-x-0 bottom-full mb-2"}`} role="alert"><WarningCircle size={15} className="shrink-0 text-[var(--text-subtle)]" /><span>El servicio no está disponible. Puedes revisar el historial.</span><button type="button" className="min-h-8 rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-[11px] font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" onClick={onRetryRuntime}>Reintentar</button></div> : null}
          <div
            ref={composerShellRef}
            data-testid="composer"
            className={`composer-shadow relative flex flex-col rounded-[28px] border bg-[var(--surface-raised)] p-2 ${hasMessages && !attachments.length && !documents.length ? "composer-compact" : ""} ${hasMessages ? "" : "min-h-[128px] justify-end"} ${dragActive ? "border-[var(--brain-accent)] ring-2 ring-[var(--brain-accent-soft)]" : "border-transparent"}`}
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
                    <span className="min-w-0"><span className="block truncate text-[12px] font-medium text-[var(--text-secondary)]">{attachment.name}</span><span className="block text-[11px] text-[var(--text-subtle)]">Lista · {Math.ceil(attachment.size / 1024)} KB</span></span>
                    <button type="button" aria-label={`Quitar ${attachment.name}`} className="ml-auto grid size-5 shrink-0 place-items-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]" onClick={() => onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))}><X size={10} /></button>
                  </div>
                ))}
                {documents.map((document) => (
                  <div key={document.uploadId} className={`group/attachment flex min-w-0 max-w-64 shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 ${document.status === "error" ? "border-[var(--danger)] bg-[var(--danger-soft)]" : "border-[var(--border)] bg-[var(--surface-muted)]"}`}>
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--surface-raised)] text-[var(--text-muted)]">{document.status === "uploading" ? <SpinnerGap size={12} className="motion-safe:animate-spin" /> : <FileIcon size={12} />}</span>
                    <span className="min-w-0"><span className="block truncate text-[12px] font-medium text-[var(--text-secondary)]">{document.name}</span><span className={`block truncate text-[11px] ${document.status === "error" ? "text-[var(--danger)]" : "text-[var(--text-subtle)]"}`}>{document.status === "uploading" ? "Preparando vista previa…" : document.status === "error" ? document.error : `Lista · ${document.kind.toUpperCase()}${document.pages ? ` · ${document.pages} pág.` : ""}`}</span></span>
                    {document.status === "ready" && document.previewFiles[0] ? <a href={document.previewFiles[0].url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-[var(--brain-accent)] hover:underline">Abrir</a> : null}
                    <button type="button" aria-label={`Quitar ${document.name}`} className="ml-auto grid size-5 shrink-0 place-items-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]" onClick={() => onDocumentsChange(documents.filter((item) => item.uploadId !== document.uploadId))}><X size={10} /></button>
                  </div>
                ))}
              </div>
            ) : null}
            <div
              ref={composerMeasurementRef}
              aria-hidden="true"
              className="composer-measurement pointer-events-none invisible absolute inset-x-2 top-2 whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {`${prompt}\u200b`}
            </div>
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
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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
                <button aria-label="Añadir al mensaje" aria-expanded={composerMenuOpen} className={`composer-add-button composer-tool !grid !size-8 !place-items-center !rounded-full ${composerMenuOpen ? "composer-tool-active" : ""}`} disabled={sending || !project} onClick={() => { setComposerPickerOpen(null); setComposerMenuOpen((current) => !current); }}><span className="composer-add-icon" aria-hidden="true"><Plus size={15} /></span></button>
                <span className="composer-mode-chip rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[12px] font-medium text-[var(--text-secondary)]">Trabajar</span>
                <span className="composer-destination max-w-44 truncate text-[12px] text-[var(--text-subtle)]" aria-label="Destino de la conversación">{standaloneConversation ? "Sin proyecto" : project?.name ?? "Sin proyecto"}</span>
                {showAdvancedControls && manifest.composer.skills && runtimeStatus.skills.length ? (
                  <ComposerPicker
                    ariaLabel="Herramienta"
                    value={selectedSkill ?? ""}
                    valueLabel={runtimeStatus.skills.find((skill) => skill.id === selectedSkill)?.label ?? "Sin herramienta"}
                    options={[{ value: "", label: "Sin herramienta" }, ...runtimeStatus.skills.map((skill) => ({ value: skill.id, label: skill.label, icon: <Wrench size={12} /> }))]}
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
                    ariaLabel="Forma de trabajo"
                    value={composerModel ?? ""}
                    valueLabel={selectedModelOption?.label ?? runtimeStatus.model ?? "Automático recomendado"}
                    options={[
                      { value: "", label: runtimeStatus.model ?? "Automático recomendado", detail: "Recomendado" },
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
                    ariaLabel="Profundidad del trabajo"
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
                <VoiceDictationControl
                  value={prompt}
                  disabled={!project || sending || documentUploading}
                  language={manifest.identity.language === "ca" ? "ca-ES" : manifest.identity.language === "en" ? "en-US" : "es-ES"}
                  onChange={onPromptChange}
                  onNotice={onComposerNotice}
                />
                <button
                  aria-label={sending ? (stopping ? "Deteniendo respuesta" : "Detener respuesta") : "Enviar mensaje"}
                  aria-busy={stopping || undefined}
                  className={`composer-submit grid size-11 place-items-center rounded-xl transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 sm:size-8 sm:rounded-full ${sending ? "bg-[var(--text)] text-[var(--surface)]" : "bg-[var(--brain-accent)] text-[var(--brain-contrast)]"}`}
                  disabled={sending ? stopping : !project || !prompt.trim() || !runtimeReady || documentUploading}
                  onClick={() => {
                    if (sending) {
                      onStop();
                      return;
                    }
                    shouldStickToBottomRef.current = true;
                    onSend();
                  }}
                >
                  <span key={sending ? "stop" : "send"} className="composer-submit-icon" aria-hidden="true">
                    {sending ? <Stop size={11} weight="fill" /> : <ArrowUp size={13} weight="bold" />}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div> : null}
    </main>
  );
}
