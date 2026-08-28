"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AuthSession } from "@/auth/types";
import { ChatWorkspace } from "@/components/chat-workspace";
import { BrowserPanel } from "@/components/browser-panel";
import { CommandPalette } from "@/components/command-palette";
import { CustomizationPanel } from "@/components/customization-panel";
import { DetailsPanel } from "@/components/details-panel";
import { MemoryPanel } from "@/components/memory-panel";
import {
  Sidebar,
  type ProjectMenuAction,
  type ThreadMenuAction,
} from "@/components/sidebar";
import { ConfirmDialog, TextDialog } from "@/components/workbench-dialogs";
import {
  cornerTokens,
  preferencesFromManifest,
  type BrainManifest,
  type BrainPreferences,
  type BrainWindowId,
} from "@/config/brain";
import {
  applyChatStreamEvent,
  type ApprovalDecision,
  type ApprovalItem,
  type ChatMessage,
  type ChatInputAttachment,
  type ComposerMode,
} from "@/lib/chat-contract";
import { consumeChatEventStream } from "@/ui/app-server-ui-adapter";
import { createChatEventFrameDispatcher } from "@/ui/frame-event-dispatcher";
import {
  stageDocument,
  type StagedComposerDocument,
} from "@/ui/document-ui-adapter";
import {
  decideDocumentPublication,
  freezeDocumentPublication,
  type DocumentPublicationDraft,
} from "@/ui/publication-ui-adapter";
import {
  initialRuntimeStatus,
  isRuntimeStatus,
  type RuntimeReasoningEffort,
  type RuntimeStatus,
} from "@/lib/runtime-status";
import {
  createProjectRequest,
  createThreadRequest,
  updateProjectRequest,
  updateThreadRequest,
} from "@/lib/workbench-api-client";
import {
  isWorkbenchSnapshot,
  STANDALONE_PROJECT_SLUG,
  type UpdateProjectInput,
  type UpdateThreadInput,
  type WorkbenchProject,
  type WorkbenchSnapshot,
  type WorkbenchThread,
} from "@/workbench/types";
import type { PublicInstallationBranding } from "@/config/installation-branding";

type SideWindowId = Exclude<BrainWindowId, "chat" | "runtime">;

type BrainStyle = CSSProperties & {
  "--brain-accent": string;
  "--brain-accent-strong": string;
  "--brain-accent-on-soft": string;
  "--brain-accent-soft": string;
  "--brain-contrast": string;
  "--brain-radius": string;
};

type TextDialogState =
  | { kind: "create-project" }
  | { kind: "rename-project"; project: WorkbenchProject }
  | { kind: "rename-thread"; thread: WorkbenchThread };

type ConfirmDialogState =
  | { kind: "archive-project"; project: WorkbenchProject }
  | { kind: "archive-thread"; thread: WorkbenchThread }
  | { kind: "undo-result"; message: ChatMessage };

type StoredSelection = {
  activeProjectId: string | null;
  threadByProject: Record<string, string>;
};

function createMessage(
  id: string,
  role: ChatMessage["role"],
  content: string,
  status: ChatMessage["status"],
  createdAt: string,
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt,
    status,
    activity: [],
    plan: [],
    approvals: [],
    diff: "",
    attachments: [],
    artifacts: [],
  };
}

function titleFromMessage(message: string) {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 52 ? `${clean.slice(0, 49)}…` : clean;
}

function publicationTarget(fileName: string) {
  const safeName = fileName.replace(/[\\/\u0000-\u001f\u007f]/g, "-").trim() || "documento";
  return `knowledge/${safeName}`;
}

function byPriority<Item extends { pinned: boolean; updatedAt: string }>(a: Item, b: Item) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function firstActiveProject(projects: WorkbenchProject[]) {
  return projects.filter((project) => project.status === "active").sort(byPriority)[0] ?? null;
}

function firstActiveThread(threads: WorkbenchThread[], projectId: string) {
  return threads
    .filter((thread) => thread.projectId === projectId && thread.status === "active")
    .sort(byPriority)[0] ?? null;
}

function updateThreadMessage(
  threads: WorkbenchThread[],
  threadId: string,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
) {
  const now = new Date().toISOString();
  return threads.map((thread) => thread.id === threadId
    ? {
        ...thread,
        updatedAt: now,
        messages: thread.messages.map((message) =>
          message.id === messageId ? updater(message) : message,
        ),
      }
    : thread);
}

function loadPreferences(key: string, defaults: BrainPreferences): BrainPreferences {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!stored || typeof stored !== "object") return defaults;

    return {
      ...defaults,
      ...("assistantName" in stored && typeof stored.assistantName === "string"
        ? { assistantName: stored.assistantName }
        : {}),
      ...("tone" in stored && (stored.tone === "direct" || stored.tone === "balanced" || stored.tone === "detailed")
        ? { tone: stored.tone }
        : {}),
      ...("accent" in stored && (stored.accent === "graphite" || stored.accent === "blue" || stored.accent === "violet")
        ? { accent: stored.accent }
        : {}),
      ...("density" in stored && (stored.density === "comfortable" || stored.density === "compact")
        ? { density: stored.density }
        : {}),
      ...("corners" in stored && (stored.corners === "soft" || stored.corners === "rounded" || stored.corners === "precise")
        ? { corners: stored.corners }
        : {}),
      ...("showInspector" in stored && typeof stored.showInspector === "boolean"
        ? { showInspector: stored.showInspector }
        : {}),
      ...("showActivityPanel" in stored && typeof stored.showActivityPanel === "boolean"
        ? { showActivityPanel: stored.showActivityPanel }
        : {}),
      ...("conversationMemory" in stored && typeof stored.conversationMemory === "boolean"
        ? { conversationMemory: stored.conversationMemory }
        : {}),
    };
  } catch {
    return defaults;
  }
}

function loadPreviewSnapshot(key: string, fallback: WorkbenchSnapshot) {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (isWorkbenchSnapshot(stored) && stored.persistence === "browser-preview") {
      return {
        ...stored,
        threads: stored.threads.map((thread) => ({
          ...thread,
          messages: thread.messages.map((message) => message.status === "streaming"
            ? { ...message, status: "stopped" as const }
            : message),
        })),
      };
    }
  } catch {
    // A damaged preview cache is replaced by the server-provided seed.
  }
  return fallback;
}

function loadSelection(key: string): StoredSelection {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!stored || typeof stored !== "object") throw new Error("invalid");
    const activeProjectId = "activeProjectId" in stored &&
      (stored.activeProjectId === null || typeof stored.activeProjectId === "string")
      ? stored.activeProjectId
      : null;
    const threadByProject: Record<string, string> = {};
    if ("threadByProject" in stored && stored.threadByProject &&
      typeof stored.threadByProject === "object" && !Array.isArray(stored.threadByProject)) {
      for (const [projectId, threadId] of Object.entries(stored.threadByProject)) {
        if (typeof threadId === "string") threadByProject[projectId] = threadId;
      }
    }
    return { activeProjectId, threadByProject };
  } catch {
    return { activeProjectId: null, threadByProject: {} };
  }
}

function localProject(projects: WorkbenchProject[], name: string): WorkbenchProject {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "projecte";
  const used = new Set(projects.map((project) => project.slug));
  let slug = normalized.slice(0, 55);
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${normalized.slice(0, 50)}-${suffix}`;
    suffix += 1;
  }
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    slug,
    status: "active",
    pinned: false,
    workspace: {
      id: crypto.randomUUID(),
      label: "Workspace principal",
      hostType: "managed",
      status: "ready",
      isPrimary: true,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function localThread(projectId: string, title: string): WorkbenchThread {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    projectId,
    title,
    status: "active",
    pinned: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

async function chatError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return "El servicio no está disponible en este momento.";
}

export function BrainApp({
  branding,
  manifest,
  session,
  initialWorkbench,
}: {
  branding: Readonly<PublicInstallationBranding>;
  manifest: BrainManifest;
  session: AuthSession;
  initialWorkbench: WorkbenchSnapshot;
}) {
  const defaultPreferences = useMemo(() => preferencesFromManifest(manifest), [manifest]);
  const preferencesKey = `aibrain.${session.tenant.id}.preferences.v3`;
  const previewKey = `aibrain.${session.tenant.id}.workbench.preview.v1`;
  const selectionKey = `aibrain.${session.tenant.id}.selection.v1`;
  const [projects, setProjects] = useState(initialWorkbench.projects);
  const [threads, setThreads] = useState(initialWorkbench.threads);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<BrainPreferences>(() => preferencesFromManifest(manifest));
  const [prompt, setPrompt] = useState("");
  const [pendingRuntimeContext, setPendingRuntimeContext] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>("agent");
  const [composerModel, setComposerModel] = useState<string | null>(null);
  const [composerEffort, setComposerEffort] = useState<RuntimeReasoningEffort | null>("low");
  // Keep the hosted Codex web tool available by default, matching Codex's
  // normal agent behavior. The employee can still opt out per page session.
  const [webSearch, setWebSearch] = useState(() => manifest.composer.webSearch);
  const [imageGeneration, setImageGeneration] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatInputAttachment[]>([]);
  const [documents, setDocuments] = useState<StagedComposerDocument[]>([]);
  const [publications, setPublications] = useState<DocumentPublicationDraft[]>([]);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [activeSideWindow, setActiveSideWindow] = useState<SideWindowId | null>(null);
  const [customizationOpen, setCustomizationOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(initialRuntimeStatus);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [runtimeRetry, setRuntimeRetry] = useState(0);
  const [textDialog, setTextDialog] = useState<TextDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const threadByProjectRef = useRef<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const snapshot = initialWorkbench.persistence === "browser-preview"
      ? loadPreviewSnapshot(previewKey, initialWorkbench)
      : initialWorkbench;
    const savedSelection = loadSelection(selectionKey);
    const preferredProject = snapshot.projects.find((project) =>
      project.id === savedSelection.activeProjectId && project.status === "active");
    const project = preferredProject ?? firstActiveProject(snapshot.projects);
    const preferredThreadId = project ? savedSelection.threadByProject[project.id] : null;
    const preferredThread = snapshot.threads.find((thread) =>
      thread.id === preferredThreadId && thread.projectId === project?.id && thread.status === "active");
    const thread = project ? preferredThread ?? firstActiveThread(snapshot.threads, project.id) : null;

    setProjects(snapshot.projects);
    setThreads(snapshot.threads);
    setActiveProjectId(project?.id ?? null);
    setActiveThreadId(thread?.id ?? null);
    setPreferences(loadPreferences(preferencesKey, defaultPreferences));
    threadByProjectRef.current = savedSelection.threadByProject;
    if (project && thread) threadByProjectRef.current[project.id] = thread.id;
    setHydrated(true);
  }, [defaultPreferences, initialWorkbench, preferencesKey, previewKey, selectionKey]);

  useEffect(() => {
    if (!hydrated || initialWorkbench.persistence !== "browser-preview") return;
    const snapshot: WorkbenchSnapshot = {
      persistence: "browser-preview",
      projects,
      threads,
    };
    localStorage.setItem(previewKey, JSON.stringify(snapshot));
  }, [hydrated, initialWorkbench.persistence, previewKey, projects, threads]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    if (!preferences.conversationMemory) {
      localStorage.removeItem(selectionKey);
      return;
    }
    if (activeProjectId && activeThreadId) {
      threadByProjectRef.current[activeProjectId] = activeThreadId;
    }
    localStorage.setItem(selectionKey, JSON.stringify({
      activeProjectId,
      threadByProject: threadByProjectRef.current,
    } satisfies StoredSelection));
  }, [activeProjectId, activeThreadId, hydrated, preferences, preferencesKey, selectionKey]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const updateNetwork = () => {
      const online = navigator.onLine;
      setNetworkOnline(online);
      if (online) setRuntimeRetry((current) => current + 1);
      else setRuntimeStatus((current) => ({ ...current, codex: "unavailable", ready: false }));
    };
    setNetworkOnline(navigator.onLine);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    return () => {
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const starter = params.get("starter")?.trim();
    if (starter) setPrompt(starter.slice(0, 400));
    if (starter) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [hydrated]);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads],
  );
  const selectedMessage = useMemo(
    () => activeThread?.messages.find((message) => message.id === selectedMessageId) ??
      activeThread?.messages.findLast((message) => message.role === "assistant") ?? null,
    [activeThread, selectedMessageId],
  );

  useEffect(() => {
    if (!hydrated || !networkOnline) return;
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => {
      if (disposed) return;
      setRuntimeStatus((current) => ({ ...current, codex: "unavailable", ready: false }));
      controller.abort();
    }, 25_000);
    const query = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : "";
    setRuntimeStatus((current) => ({ ...current, codex: "checking", ready: false }));
    void fetch(`/api/runtime/status${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((status: unknown) => {
        if (isRuntimeStatus(status)) {
          setRuntimeStatus(status);
          if (status.mode === "codex" && !status.capabilities.webSearch) setWebSearch(false);
        } else setRuntimeStatus((current) => ({ ...current, codex: "unavailable", ready: false }));
      })
      .catch(() => {
        if (!disposed) {
          setRuntimeStatus((current) => ({ ...current, codex: "unavailable", ready: false }));
        }
      });
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeProjectId, hydrated, networkOnline, runtimeRetry]);

  const style = useMemo<BrainStyle>(() => {
    return {
      "--brain-accent": branding.accentColor,
      "--brain-accent-strong": `color-mix(in srgb, ${branding.accentColor} 72%, #000000)`,
      "--brain-accent-on-soft": `color-mix(in srgb, ${branding.accentColor} 45%, var(--text))`,
      "--brain-accent-soft": `color-mix(in srgb, ${branding.accentColor} 12%, transparent)`,
      "--brain-contrast": "#ffffff",
      "--brain-radius": cornerTokens[preferences.corners],
    };
  }, [branding.accentColor, preferences.corners]);

  const selectProject = useCallback((projectId: string) => {
    if (sending || documentUploading) {
      setNotice("Detén la respuesta actual antes de cambiar de proyecto.");
      return;
    }
    const project = projects.find((candidate) => candidate.id === projectId && candidate.status === "active");
    if (!project) return;
    if (activeProjectId && activeThreadId) threadByProjectRef.current[activeProjectId] = activeThreadId;
    const rememberedId = threadByProjectRef.current[projectId];
    const remembered = threads.find((thread) =>
      thread.id === rememberedId && thread.projectId === projectId && thread.status === "active");
    const thread = remembered ?? firstActiveThread(threads, projectId);
    setActiveProjectId(projectId);
    setActiveThreadId(thread?.id ?? null);
    setPendingRuntimeContext(null);
    setAttachments([]);
    setDocuments([]);
    setSelectedMessageId(null);
    setActiveSideWindow(null);
    setMobileSidebarOpen(false);
  }, [activeProjectId, activeThreadId, documentUploading, projects, sending, threads]);

  const selectThread = useCallback((threadId: string) => {
    if (sending || documentUploading) {
      setNotice("Detén la respuesta actual antes de cambiar de conversación.");
      return;
    }
    const thread = threads.find((candidate) => candidate.id === threadId && candidate.status === "active");
    if (!thread) return;
    setActiveProjectId(thread.projectId);
    setActiveThreadId(thread.id);
    setPendingRuntimeContext(null);
    setAttachments([]);
    setDocuments([]);
    threadByProjectRef.current[thread.projectId] = thread.id;
    setSelectedMessageId(null);
    setMobileSidebarOpen(false);
  }, [documentUploading, sending, threads]);

  const startNewThread = useCallback(() => {
    if (sending || documentUploading) return;
    const standaloneProject = projects.find((project) =>
      project.slug === STANDALONE_PROJECT_SLUG && project.status === "active");
    if (!standaloneProject) {
      setNotice("No se ha podido preparar el espacio de conversaciones.");
      return;
    }
    if (activeProjectId) delete threadByProjectRef.current[activeProjectId];
    delete threadByProjectRef.current[standaloneProject.id];
    setActiveProjectId(standaloneProject.id);
    setActiveThreadId(null);
    setSelectedMessageId(null);
    setPrompt("");
    setPendingRuntimeContext(null);
    setAttachments([]);
    setDocuments([]);
    setActiveSideWindow(null);
    setMobileSidebarOpen(false);
  }, [activeProjectId, documentUploading, projects, sending]);

  const createVersionFromMessage = useCallback(async (message: ChatMessage) => {
    if (!activeProject || sending || actionBusy || !message.content.trim()) return;
    setActionBusy(true);
    try {
      const baseTitle = activeThread?.title ?? "Resultado";
      const title = `${baseTitle.replace(/ · (?:nova versió|nueva versión)$/, "")} · nueva versión`.slice(0, 120);
      const thread = initialWorkbench.persistence === "browser-preview"
        ? localThread(activeProject.id, title)
        : await createThreadRequest(activeProject.id, title);
      setThreads((current) => [thread, ...current]);
      setActiveThreadId(thread.id);
      threadByProjectRef.current[activeProject.id] = thread.id;
      setSelectedMessageId(null);
      setPrompt([
        "Quiero crear una nueva versión de este resultado. Pregúntame qué quiero cambiar.",
      ].join("\n"));
      setPendingRuntimeContext(`Resultado de partida que debe conservarse intacto:\n\n${message.content.slice(0, 12_000)}`);
      setAttachments([]);
      setDocuments([]);
      setActiveSideWindow(null);
      setNotice("Nueva versión preparada en una conversación separada. El original se conserva.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido preparar una nueva versión.");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, activeProject, activeThread?.title, initialWorkbench.persistence, sending]);

  const addDocuments = useCallback(async (files: File[]) => {
    if (!activeProject || documentUploading || sending) return;
    if (initialWorkbench.persistence !== "filesystem") {
      setNotice("Los documentos reales requieren el runtime privado de la instalación.");
      return;
    }
    const available = Math.max(0, 10 - documents.filter((document) => document.status !== "error").length);
    const selected = files.slice(0, available);
    if (files.length > available) setNotice("Puedes preparar un máximo de 10 documentos por turno.");
    if (!selected.length) return;

    let thread = activeThread && activeThread.status === "active" && activeThread.projectId === activeProject.id
      ? activeThread
      : null;
    setDocumentUploading(true);
    try {
      if (!thread) {
        thread = await createThreadRequest(activeProject.id, "Conversación con documentos");
        setThreads((current) => [thread as WorkbenchThread, ...current]);
        setActiveThreadId(thread.id);
        threadByProjectRef.current[activeProject.id] = thread.id;
      }
      for (const file of selected) {
        const uploadId = crypto.randomUUID();
        const placeholder: StagedComposerDocument = {
          id: uploadId,
          uploadId,
          threadId: thread.id,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          kind: "text",
          previewFiles: [],
          pages: null,
          status: "uploading",
          error: null,
        };
        setDocuments((current) => [...current, placeholder]);
        try {
          const result = await stageDocument(thread.id, file, uploadId);
          setDocuments((current) => current.map((document) => document.uploadId === uploadId ? {
            ...document,
            name: result.document.fileName,
            mimeType: result.document.mediaType,
            size: result.document.size,
            kind: result.document.kind,
            previewFiles: result.preview.files,
            pages: result.preview.pages,
            status: "ready",
          } : document));
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "No se ha podido preparar el documento.";
          setDocuments((current) => current.map((document) => document.uploadId === uploadId
            ? { ...document, status: "error", error: message }
            : document));
          setNotice(message);
        }
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "No se ha podido abrir una conversación para el documento.");
    } finally {
      setDocumentUploading(false);
    }
  }, [activeProject, activeThread, documentUploading, documents, initialWorkbench.persistence, sending]);

  const freezePublication = useCallback(async (draftId: string, targetRelativePath: string) => {
    const draft = publications.find((candidate) => candidate.id === draftId);
    if (!draft || draft.phase === "freezing" || draft.phase === "deciding") return;
    setPublications((current) => current.map((candidate) => candidate.id === draftId
      ? { ...candidate, targetRelativePath, phase: "freezing", error: null }
      : candidate));
    try {
      const receipt = await freezeDocumentPublication(draft, targetRelativePath);
      setPublications((current) => current.map((candidate) => candidate.id === draftId ? {
        ...candidate,
        targetRelativePath,
        phase: "awaiting_confirmation",
        operation: receipt.operation,
        confirmationToken: receipt.confirmationToken,
        permissionFingerprint: receipt.permissionFingerprint,
        error: null,
      } : candidate));
    } catch (error) {
      setPublications((current) => current.map((candidate) => candidate.id === draftId ? {
        ...candidate,
        targetRelativePath,
        phase: "error",
        error: error instanceof Error ? error.message : "No se ha podido preparar la publicación.",
      } : candidate));
    }
  }, [publications]);

  const decidePublication = useCallback(async (draftId: string, action: "confirm" | "decline") => {
    const draft = publications.find((candidate) => candidate.id === draftId);
    if (!draft || draft.phase !== "awaiting_confirmation") return;
    setPublications((current) => current.map((candidate) => candidate.id === draftId
      ? { ...candidate, phase: "deciding", error: null }
      : candidate));
    try {
      const receipt = await decideDocumentPublication(draft, action);
      const phase = receipt.operation.status === "publishing"
        ? "deciding"
        : receipt.operation.status;
      setPublications((current) => current.map((candidate) => candidate.id === draftId ? {
        ...candidate,
        phase,
        operation: receipt.operation,
        confirmationToken: null,
        permissionFingerprint: receipt.permissionFingerprint,
        error: null,
      } : candidate));
    } catch (error) {
      setPublications((current) => current.map((candidate) => candidate.id === draftId ? {
        ...candidate,
        phase: "awaiting_confirmation",
        error: error instanceof Error ? error.message : "No se ha podido aplicar la decisión.",
      } : candidate));
    }
  }, [publications]);

  const handleStream = useCallback(async (
    response: Response,
    threadId: string,
    assistantMessageId: string,
    signal: AbortSignal,
  ) => {
    if (!response.ok) throw new Error(await chatError(response));
    const dispatcher = createChatEventFrameDispatcher((event) => {
      setThreads((current) => updateThreadMessage(
        current,
        threadId,
        assistantMessageId,
        (message) => applyChatStreamEvent(message, event),
      ));
    });
    try {
      await consumeChatEventStream(response, dispatcher.dispatch, { signal });
    } finally {
      dispatcher.close();
    }
  }, []);

  const sendMessage = useCallback(async (messageOverride?: string, displayMessageOverride?: string) => {
    const visibleContent = (displayMessageOverride ?? messageOverride ?? prompt).trim();
    const runtimeContent = (messageOverride ?? (pendingRuntimeContext
      ? `${prompt.trim()}\n\n${pendingRuntimeContext}`
      : prompt)).trim();
    if (!visibleContent || !runtimeContent || sending || documentUploading || !activeProject || activeProject.status !== "active") return;

    setSending(true);
    let thread = activeThread && activeThread.status === "active" &&
      activeThread.projectId === activeProject.id ? activeThread : null;
    let assistantMessage: ChatMessage | null = null;
    let succeeded = false;
    try {
      if (!thread) {
        const title = titleFromMessage(visibleContent);
        thread = initialWorkbench.persistence === "browser-preview"
          ? localThread(activeProject.id, title)
          : await createThreadRequest(activeProject.id, title);
        setThreads((current) => [thread as WorkbenchThread, ...current]);
        setActiveThreadId(thread.id);
        threadByProjectRef.current[activeProject.id] = thread.id;
      }

      const startedAt = new Date();
      const userMessage = createMessage(
        crypto.randomUUID(),
        "user",
        visibleContent,
        "complete",
        startedAt.toISOString(),
      );
      const readyDocuments = documents.filter((document) => document.status === "ready");
      userMessage.attachments = [
        ...attachments.map(({ dataUrl: _dataUrl, ...attachment }) => attachment),
        ...readyDocuments.map(({ uploadId: _uploadId, threadId: _threadId, kind: _kind, previewFiles: _previewFiles, pages: _pages, status: _status, error: _error, ...attachment }) => attachment),
      ];
      assistantMessage = createMessage(
        crypto.randomUUID(),
        "assistant",
        "",
        "streaming",
        new Date(startedAt.getTime() + 1).toISOString(),
      );
      const threadId = thread.id;
      const assistantId = assistantMessage.id;
      if (readyDocuments.length) {
        setPublications((current) => [
          ...current.filter((candidate) => !readyDocuments.some((document) => document.uploadId === candidate.uploadId)),
          ...readyDocuments.map((document): DocumentPublicationDraft => ({
            id: document.uploadId,
            threadId,
            turnId: assistantId,
            uploadId: document.uploadId,
            fileName: document.name,
            size: document.size,
            targetRelativePath: publicationTarget(document.name),
            phase: "ready",
            operation: null,
            confirmationToken: null,
            permissionFingerprint: null,
            error: null,
          })),
        ]);
      }
      setThreads((current) => current.map((candidate) => candidate.id === threadId
        ? {
            ...candidate,
            updatedAt: startedAt.toISOString(),
            messages: [...candidate.messages, userMessage, assistantMessage as ChatMessage],
          }
        : candidate));
      setSelectedMessageId(assistantId);
      setPrompt("");
      setPendingRuntimeContext(null);
      setAttachments([]);
      setDocuments([]);

      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          projectId: activeProject.id,
          threadId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantId,
          message: runtimeContent,
          ...(visibleContent !== runtimeContent ? { displayMessage: visibleContent } : {}),
          preferences: {
            tone: preferences.tone,
            language: manifest.identity.language,
            showActivity: preferences.showActivityPanel,
          },
          options: {
            mode: composerMode,
            model: composerModel,
            effort: composerEffort,
            webSearch,
            imageGeneration,
            skill: selectedSkill,
            attachments,
            ...(readyDocuments.length ? { documentUploadIds: readyDocuments.map((document) => document.uploadId) } : {}),
          },
        }),
      });
      await handleStream(response, threadId, assistantId, controller.signal);
      succeeded = true;
    } catch (error) {
      if (thread && assistantMessage) {
        const stopped = abortRef.current?.signal.aborted === true;
        const failedThreadId = thread.id;
        const failedMessageId = assistantMessage.id;
        setThreads((current) => updateThreadMessage(
          current,
          failedThreadId,
          failedMessageId,
          (message) => ({
            ...message,
            status: stopped ? "stopped" : "error",
            ...(!stopped && !message.content
              ? { content: error instanceof Error ? error.message : "Error desconocido" }
              : {}),
          }),
        ));
      } else {
        setNotice(error instanceof Error ? error.message : "No se ha podido crear la conversación.");
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
    return succeeded;
  }, [activeProject, activeThread, attachments, composerEffort, composerMode, composerModel, documentUploading, documents, handleStream, imageGeneration, initialWorkbench.persistence, manifest.identity.language, pendingRuntimeContext, preferences, prompt, selectedSkill, sending, webSearch]);

  const stopActiveTurn = useCallback(async () => {
    const controller = abortRef.current;
    const activeAssistant = activeThread
      ? [...activeThread.messages].reverse().find((message) =>
          message.role === "assistant" && message.status === "streaming")
      : null;
    if (initialWorkbench.persistence !== "filesystem" || !activeThread || !activeAssistant) {
      controller?.abort();
      return;
    }
    try {
      const response = await fetch("/api/runtime/turns/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          threadId: activeThread.id,
          assistantMessageId: activeAssistant.id,
          clientRequestId: crypto.randomUUID(),
        }),
      });
      if (!response.ok && response.status !== 409) {
        setNotice("No s’ha pogut confirmar l’aturada amb el runtime.");
      }
    } catch {
      setNotice("S’ha perdut la connexió mentre s’aturava el torn.");
    } finally {
      controller?.abort();
    }
  }, [activeThread, initialWorkbench.persistence]);

  const persistResultAction = useCallback(async (
    message: ChatMessage,
    action: "approved" | "pending" | "undo",
  ) => {
    if (!activeThreadId || actionBusy || sending) return;
    if (action === "undo") {
      setConfirmDialog({ kind: "undo-result", message });
      return;
    }
    setActionBusy(true);
    try {
      const response = await fetch(`/api/threads/${activeThreadId}/messages/${message.id}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || !result || typeof result !== "object" || !("message" in result)) {
        throw new Error("No se ha podido guardar la revisión.");
      }
      const updated = result.message as ChatMessage;
      setThreads((current) => updateThreadMessage(current, activeThreadId, message.id, () => updated));
      setNotice(action === "approved" ? "Resultado aprobado y guardado." : "Resultado marcado como pendiente.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido actualizar el resultado.");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, activeThreadId, sending]);

  const resolveApproval = useCallback(async (
    messageId: string,
    selectedApproval: ApprovalItem,
    decision: ApprovalDecision,
  ) => {
    if (!activeThreadId) return;
    const response = await fetch("/api/runtime/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvalId: selectedApproval.id,
        threadId: selectedApproval.threadId,
        turnId: selectedApproval.turnId,
        itemId: selectedApproval.itemId,
        decision,
      }),
    });
    if (!response.ok) {
      setNotice("Esta aprobación ya no está pendiente.");
      return;
    }
    const status = decision === "accept"
      ? "accepted"
      : decision === "acceptForSession" ? "accepted_session" : "declined";
    setThreads((current) => updateThreadMessage(
      current,
      activeThreadId,
      messageId,
      (message) => ({
        ...message,
        approvals: message.approvals.map((approval) =>
          approval.id === selectedApproval.id ? { ...approval, status } : approval),
      }),
    ));
  }, [activeThreadId]);

  const persistProjectPatch = useCallback(async (
    project: WorkbenchProject,
    patch: UpdateProjectInput,
  ) => {
    setActionBusy(true);
    try {
      const updated: WorkbenchProject = initialWorkbench.persistence === "browser-preview"
        ? {
            ...project,
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            updatedAt: new Date().toISOString(),
          }
        : await updateProjectRequest(project.id, patch);
      const nextProjects = projects.map((candidate) => candidate.id === project.id ? updated : candidate);
      setProjects(nextProjects);
      if (updated.status === "archived" && activeProjectId === updated.id) {
        const next = firstActiveProject(nextProjects);
        setActiveProjectId(next?.id ?? null);
        setActiveThreadId(next ? firstActiveThread(threads, next.id)?.id ?? null : null);
        setSelectedMessageId(null);
      }
      return updated;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido actualizar el proyecto.");
      return null;
    } finally {
      setActionBusy(false);
    }
  }, [activeProjectId, initialWorkbench.persistence, projects, threads]);

  const persistThreadPatch = useCallback(async (
    thread: WorkbenchThread,
    patch: UpdateThreadInput,
  ) => {
    setActionBusy(true);
    try {
      const updated: WorkbenchThread = initialWorkbench.persistence === "browser-preview"
        ? {
            ...thread,
            ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
            ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            updatedAt: new Date().toISOString(),
          }
        : await updateThreadRequest(thread.id, patch);
      const nextThreads = threads.map((candidate) => candidate.id === thread.id ? updated : candidate);
      setThreads(nextThreads);
      if (updated.status === "archived" && activeThreadId === updated.id) {
        const next = firstActiveThread(nextThreads, updated.projectId);
        setActiveThreadId(next?.id ?? null);
        setSelectedMessageId(null);
      }
      return updated;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido actualizar la conversación.");
      return null;
    } finally {
      setActionBusy(false);
    }
  }, [activeThreadId, initialWorkbench.persistence, threads]);

  const submitTextDialog = useCallback(async (value: string) => {
    if (!textDialog) return;
    if (textDialog.kind === "create-project") {
      setActionBusy(true);
      try {
        const project = initialWorkbench.persistence === "browser-preview"
          ? localProject(projects, value)
          : await createProjectRequest(value);
        setProjects((current) => [project, ...current]);
        setActiveProjectId(project.id);
        setActiveThreadId(null);
        setSelectedMessageId(null);
        setTextDialog(null);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "No se ha podido crear el proyecto.");
      } finally {
        setActionBusy(false);
      }
      return;
    }
    if (textDialog.kind === "rename-project") {
      if (await persistProjectPatch(textDialog.project, { name: value })) setTextDialog(null);
      return;
    }
    if (await persistThreadPatch(textDialog.thread, { title: value })) setTextDialog(null);
  }, [initialWorkbench.persistence, persistProjectPatch, persistThreadPatch, projects, textDialog]);

  const handleProjectAction = useCallback((project: WorkbenchProject, action: ProjectMenuAction) => {
    if (action === "rename") setTextDialog({ kind: "rename-project", project });
    else if (action === "archive") setConfirmDialog({ kind: "archive-project", project });
    else if (action === "restore") void persistProjectPatch(project, { status: "active" });
    else void persistProjectPatch(project, { pinned: action === "pin" });
  }, [persistProjectPatch]);

  const handleThreadAction = useCallback((thread: WorkbenchThread, action: ThreadMenuAction) => {
    if (action === "rename") setTextDialog({ kind: "rename-thread", thread });
    else if (action === "archive") setConfirmDialog({ kind: "archive-thread", thread });
    else if (action === "restore") void persistThreadPatch(thread, { status: "active" });
    else void persistThreadPatch(thread, { pinned: action === "pin" });
  }, [persistThreadPatch]);

  const confirmAction = useCallback(async () => {
    if (!confirmDialog) return;
    if (confirmDialog.kind === "undo-result") {
      if (!activeThreadId) return;
      setActionBusy(true);
      const target = confirmDialog.message;
      try {
        const updateState = async (action: "undo_waiting" | "undo_complete") => {
          const response = await fetch(`/api/threads/${activeThreadId}/messages/${target.id}/result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          });
          const result: unknown = await response.json().catch(() => null);
          if (!response.ok || !result || typeof result !== "object" || !("message" in result)) {
            throw new Error("No se ha podido guardar el estado de la reversión.");
          }
          const updated = result.message as ChatMessage;
          setThreads((current) => updateThreadMessage(current, activeThreadId, target.id, () => updated));
        };
        await updateState("undo_waiting");
        setConfirmDialog(null);
        setActionBusy(false);
        const completed = await sendMessage(
          `Revierte exclusivamente los cambios de este resultado. Antes de terminar, comprueba el estado final y explica qué se ha restaurado.\n\nCambios originales:\n${target.diff.slice(0, 10_000)}`,
          "Deshaz los cambios de este resultado y comprueba que todo queda restaurado.",
        );
        setActionBusy(true);
        if (!completed) throw new Error("La reversió no s’ha pogut verificar.");
        await updateState("undo_complete");
        setNotice("Cambios revertidos y verificados. El estado se ha guardado.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "No se ha podido completar la reversión.");
      } finally {
        setActionBusy(false);
      }
      return;
    }
    const updated = confirmDialog.kind === "archive-project"
      ? await persistProjectPatch(confirmDialog.project, { status: "archived" })
      : await persistThreadPatch(confirmDialog.thread, { status: "archived" });
    if (updated) setConfirmDialog(null);
  }, [activeThreadId, confirmDialog, persistProjectPatch, persistThreadPatch, sendMessage]);

  const inspectMessage = useCallback((messageId: string) => {
    setSelectedMessageId(messageId);
    setActiveSideWindow("inspector");
  }, []);

  const changePreference = useCallback(
    <Key extends keyof BrainPreferences>(key: Key, value: BrainPreferences[Key]) => {
      setPreferences((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const enabledWindows = manifest.windows.filter((window) =>
    window.enabled && (window.id === "chat" || window.id === "inspector" || window.id === "browser"));
  const inspectorEnabled = enabledWindows.some((window) => window.id === "inspector");
  const browserEnabled = enabledWindows.some((window) => window.id === "browser");

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setDesktopSidebarOpen((current) => !current);
      return;
    }
    setMobileSidebarOpen((current) => !current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLocaleLowerCase("ca");
      if (modifier && key === "k") {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
        return;
      }
      if (modifier && key === "n" && !sending) {
        event.preventDefault();
        startNewThread();
        return;
      }
      if (modifier && event.shiftKey && key === "p" && !actionBusy) {
        event.preventDefault();
        setTextDialog({ kind: "create-project" });
        return;
      }
      if (event.key !== "Escape") return;
      if (commandPaletteOpen) setCommandPaletteOpen(false);
      else if (customizationOpen) setCustomizationOpen(false);
      else if (memoryOpen) setMemoryOpen(false);
      else if (textDialog && !actionBusy) setTextDialog(null);
      else if (confirmDialog && !actionBusy) setConfirmDialog(null);
      else if (activeSideWindow) setActiveSideWindow(null);
      else if (mobileSidebarOpen) setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    actionBusy,
    activeProject,
    activeSideWindow,
    commandPaletteOpen,
    confirmDialog,
    customizationOpen,
    memoryOpen,
    mobileSidebarOpen,
    sending,
    startNewThread,
    textDialog,
  ]);

  const textDialogCopy = textDialog?.kind === "create-project"
    ? { title: "Nuevo proyecto", label: "Nombre del proyecto", value: "", submit: "Crear proyecto", maxLength: 80 }
    : textDialog?.kind === "rename-project"
      ? { title: "Renombrar proyecto", label: "Nombre del proyecto", value: textDialog.project.name, submit: "Guardar", maxLength: 80 }
      : textDialog?.kind === "rename-thread"
        ? { title: "Renombrar conversación", label: "Título de la conversación", value: textDialog.thread.title, submit: "Guardar", maxLength: 120 }
        : null;

  return (
    <div style={style} className="flex h-[100dvh] overflow-hidden bg-[var(--page)] font-sans text-[var(--text)]">
      <Sidebar
        branding={branding}
        session={session}
        projects={projects}
        threads={threads}
        activeProjectId={activeProjectId}
        activeThreadId={activeThreadId}
        mobileOpen={mobileSidebarOpen}
        desktopOpen={desktopSidebarOpen}
        busy={actionBusy || sending}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onCloseDesktop={() => setDesktopSidebarOpen(false)}
        onOpenDesktop={() => setDesktopSidebarOpen(true)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onSelectProject={selectProject}
        onSelectThread={selectThread}
        onNewThread={startNewThread}
        onNewProject={() => setTextDialog({ kind: "create-project" })}
        onProjectAction={handleProjectAction}
        onThreadAction={handleThreadAction}
        onOpenCustomization={() => setCustomizationOpen(true)}
      />

      <ChatWorkspace
        manifest={manifest}
        preferences={preferences}
        project={activeProject}
        thread={activeThread}
        hydrated={hydrated}
        prompt={prompt}
        composerMode={composerMode}
        composerModel={composerModel}
        composerEffort={composerEffort}
        webSearch={webSearch}
        imageGeneration={imageGeneration}
        selectedSkill={selectedSkill}
        attachments={attachments}
        documents={documents}
        publications={publications}
        documentUploading={documentUploading}
        sending={sending}
        runtimeStatus={runtimeStatus}
        networkOnline={networkOnline}
        onRetryRuntime={() => setRuntimeRetry((current) => current + 1)}
        onPromptChange={setPrompt}
        onComposerModeChange={setComposerMode}
        onComposerModelChange={setComposerModel}
        onComposerEffortChange={setComposerEffort}
        onWebSearchChange={setWebSearch}
        onImageGenerationChange={setImageGeneration}
        onSelectedSkillChange={setSelectedSkill}
        onAttachmentsChange={setAttachments}
        onDocumentsChange={setDocuments}
        onAddDocuments={addDocuments}
        onFreezePublication={freezePublication}
        onDecidePublication={decidePublication}
        onComposerNotice={setNotice}
        onSend={sendMessage}
        onStop={() => void stopActiveTurn()}
        sidebarOpen={desktopSidebarOpen || mobileSidebarOpen}
        onToggleSidebar={toggleSidebar}
        onOpenCustomization={() => setCustomizationOpen(true)}
        activeSideWindow={activeSideWindow}
        canInspect={inspectorEnabled}
        onInspectMessage={inspectMessage}
        onResolveApproval={resolveApproval}
        onCreateVersion={(message) => void createVersionFromMessage(message)}
        onResultAction={persistResultAction}
        showAdvancedControls
      />

      {inspectorEnabled && preferences.showInspector && activeSideWindow === "inspector" ? (
        <DetailsPanel
          message={selectedMessage}
          open
          onClose={() => setActiveSideWindow(null)}
          onResolveApproval={(approvalId, decision) => {
            if (selectedMessage) void resolveApproval(selectedMessage.id, approvalId, decision);
          }}
        />
      ) : null}

      {activeSideWindow === "browser" ? (
        <BrowserPanel
          threadId={activeThreadId}
          open
          onClose={() => setActiveSideWindow(null)}
        />
      ) : null}

      <CustomizationPanel
        productName={branding.productName}
        open={customizationOpen}
        preferences={preferences}
        runtimeStatus={runtimeStatus}
        selectedSkill={selectedSkill}
        onSelectedSkillChange={setSelectedSkill}
        onChange={changePreference}
        onReset={() => setPreferences(defaultPreferences)}
        onClose={() => setCustomizationOpen(false)}
      />

      <MemoryPanel
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
      />

      <CommandPalette
        open={commandPaletteOpen}
        busy={actionBusy || sending}
        projects={projects}
        threads={threads}
        activeProjectId={activeProjectId}
        inspectorEnabled={inspectorEnabled}
        browserEnabled={browserEnabled}
        onClose={() => setCommandPaletteOpen(false)}
        onNewThread={startNewThread}
        onNewProject={() => setTextDialog({ kind: "create-project" })}
        onSelectProject={selectProject}
        onSelectThread={selectThread}
        onOpenInspector={() => setActiveSideWindow("inspector")}
        onOpenBrowser={() => setActiveSideWindow("browser")}
        onOpenCustomization={() => setCustomizationOpen(true)}
        onOpenMemory={() => setMemoryOpen(true)}
      />

      {textDialogCopy ? (
        <TextDialog
          open
          title={textDialogCopy.title}
          label={textDialogCopy.label}
          initialValue={textDialogCopy.value}
          maxLength={textDialogCopy.maxLength}
          submitLabel={textDialogCopy.submit}
          busy={actionBusy}
          onClose={() => !actionBusy && setTextDialog(null)}
          onSubmit={(value) => void submitTextDialog(value)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.kind === "undo-result" ? "¿Quieres deshacer estos cambios?" : confirmDialog?.kind === "archive-project" ? "¿Archivar proyecto?" : "¿Archivar conversación?"}
        description={confirmDialog?.kind === "archive-project"
          ? "El proyecto y sus conversaciones dejarán de aparecer en la vista activa. Podrás restaurarlos desde Archivados."
          : confirmDialog?.kind === "undo-result"
            ? "Se revertirán solo los cambios de este resultado, se comprobará el estado final y se conservará el original en el historial."
            : "La conversación dejará de aparecer en la lista activa. Podrás restaurarla más adelante."}
        confirmLabel={confirmDialog?.kind === "undo-result" ? "Sí, deshacer" : "Archivar"}
        busy={actionBusy}
        onClose={() => !actionBusy && setConfirmDialog(null)}
        onConfirm={() => void confirmAction()}
      />

      {notice ? (
        <div role="status" aria-live="polite" className="fixed left-1/2 top-4 z-[90] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2.5 text-[12px] font-medium text-[var(--text-secondary)] shadow-[var(--shadow-md)]">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
