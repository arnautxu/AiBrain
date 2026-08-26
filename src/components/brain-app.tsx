"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AuthSession } from "@/auth/types";
import { ChatWorkspace } from "@/components/chat-workspace";
import { CommandPalette } from "@/components/command-palette";
import { CustomizationPanel } from "@/components/customization-panel";
import { DetailsPanel } from "@/components/details-panel";
import { RuntimePanel } from "@/components/runtime-panel";
import { AutomationsPanel } from "@/components/automations-panel";
import {
  Sidebar,
  type ProjectMenuAction,
  type ThreadMenuAction,
} from "@/components/sidebar";
import { ConfirmDialog, TextDialog } from "@/components/workbench-dialogs";
import {
  accentTokens,
  cornerTokens,
  preferencesFromManifest,
  type BrainManifest,
  type BrainPreferences,
  type BrainWindowId,
} from "@/config/brain";
import {
  applyChatStreamEvent,
  isChatStreamEvent,
  type ApprovalDecision,
  type ApprovalItem,
  type ChatMessage,
  type ChatInputAttachment,
  type ComposerMode,
} from "@/lib/chat-contract";
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
  type UpdateProjectInput,
  type UpdateThreadInput,
  type WorkbenchProject,
  type WorkbenchSnapshot,
  type WorkbenchThread,
} from "@/workbench/types";

type SideWindowId = Exclude<BrainWindowId, "chat">;

type BrainStyle = CSSProperties & {
  "--brain-accent": string;
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
    if (isWorkbenchSnapshot(stored) && stored.persistence === "browser-preview") return stored;
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
  return "Resposta del runtime no disponible.";
}

export function BrainApp({
  manifest,
  session,
  initialWorkbench,
  memberPreferences,
}: {
  manifest: BrainManifest;
  session: AuthSession;
  initialWorkbench: WorkbenchSnapshot;
  memberPreferences: {
    language: "ca" | "es" | "en";
    tone: "direct" | "balanced" | "detailed";
  } | null;
}) {
  const defaultPreferences = useMemo(() => ({
    ...preferencesFromManifest(manifest),
    ...(memberPreferences ? { tone: memberPreferences.tone } : {}),
  }), [manifest, memberPreferences]);
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
  const [webSearch, setWebSearch] = useState(false);
  const [imageGeneration, setImageGeneration] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatInputAttachment[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [activeSideWindow, setActiveSideWindow] = useState<SideWindowId | null>(null);
  const [customizationOpen, setCustomizationOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(initialRuntimeStatus);
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
    const completedOnboarding = new URLSearchParams(window.location.search)
      .get("onboarding") === "complete";
    setPreferences(completedOnboarding
      ? defaultPreferences
      : loadPreferences(preferencesKey, defaultPreferences));
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
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const starter = params.get("starter")?.trim();
    if (starter) setPrompt(starter.slice(0, 400));
    if (params.get("onboarding") === "complete") {
      setNotice("Onboarding completat. La teva primera missió ja està preparada.");
    }
    if (starter || params.has("onboarding")) {
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
    if (!hydrated) return;
    const controller = new AbortController();
    const query = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : "";
    setRuntimeStatus((current) => ({ ...current, codex: "checking", ready: false }));
    void fetch(`/api/runtime/status${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((status: unknown) => {
        if (isRuntimeStatus(status)) setRuntimeStatus(status);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [activeProjectId, hydrated]);

  const style = useMemo<BrainStyle>(() => {
    const accent = accentTokens[preferences.accent];
    return {
      "--brain-accent": accent.solid,
      "--brain-accent-soft": accent.soft,
      "--brain-contrast": accent.contrast,
      "--brain-radius": cornerTokens[preferences.corners],
    };
  }, [preferences.accent, preferences.corners]);

  const selectProject = useCallback((projectId: string) => {
    if (sending) {
      setNotice("Atura el torn actual abans de canviar de projecte.");
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
    setSelectedMessageId(null);
    setActiveSideWindow(null);
    setMobileSidebarOpen(false);
  }, [activeProjectId, activeThreadId, projects, sending, threads]);

  const selectThread = useCallback((threadId: string) => {
    if (sending) {
      setNotice("Atura el torn actual abans de canviar de fil.");
      return;
    }
    const thread = threads.find((candidate) => candidate.id === threadId && candidate.status === "active");
    if (!thread) return;
    setActiveProjectId(thread.projectId);
    setActiveThreadId(thread.id);
    setPendingRuntimeContext(null);
    threadByProjectRef.current[thread.projectId] = thread.id;
    setSelectedMessageId(null);
    setMobileSidebarOpen(false);
  }, [sending, threads]);

  const startNewThread = useCallback(() => {
    if (sending) return;
    if (activeProjectId) delete threadByProjectRef.current[activeProjectId];
    setActiveThreadId(null);
    setSelectedMessageId(null);
    setPrompt("");
    setPendingRuntimeContext(null);
    setAttachments([]);
    setActiveSideWindow(null);
    setMobileSidebarOpen(false);
  }, [activeProjectId, sending]);

  const createVersionFromMessage = useCallback(async (message: ChatMessage) => {
    if (!activeProject || sending || actionBusy || !message.content.trim()) return;
    setActionBusy(true);
    try {
      const baseTitle = activeThread?.title ?? "Resultat";
      const title = `${baseTitle.replace(/ · nova versió$/, "")} · nova versió`.slice(0, 120);
      const thread = initialWorkbench.persistence === "browser-preview"
        ? localThread(activeProject.id, title)
        : await createThreadRequest(activeProject.id, title);
      setThreads((current) => [thread, ...current]);
      setActiveThreadId(thread.id);
      threadByProjectRef.current[activeProject.id] = thread.id;
      setSelectedMessageId(null);
      setPrompt([
        "Vull crear una nova versió d’aquest resultat. Pregunta’m què vull canviar.",
      ].join("\n"));
      setPendingRuntimeContext(`Resultat de partida que s’ha de conservar intacte:\n\n${message.content.slice(0, 12_000)}`);
      setAttachments([]);
      setActiveSideWindow(null);
      setNotice("Nova versió preparada en un fil separat. L’original es conserva.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No s’ha pogut preparar una nova versió.");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, activeProject, activeThread?.title, initialWorkbench.persistence, sending]);

  const handleStream = useCallback(async (
    response: Response,
    threadId: string,
    assistantMessageId: string,
  ) => {
    if (!response.ok || !response.body) throw new Error(await chatError(response));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const applyLine = (currentLine: string) => {
      if (!currentLine.trim()) return;
      const event: unknown = JSON.parse(currentLine);
      if (!isChatStreamEvent(event)) return;
      setThreads((current) => updateThreadMessage(
        current,
        threadId,
        assistantMessageId,
        (message) => applyChatStreamEvent(message, event),
      ));
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const currentLine of lines) applyLine(currentLine);
    }
    buffer += decoder.decode();
    if (buffer.trim()) applyLine(buffer);
  }, []);

  const sendMessage = useCallback(async (messageOverride?: string, displayMessageOverride?: string) => {
    const visibleContent = (displayMessageOverride ?? messageOverride ?? prompt).trim();
    const runtimeContent = (messageOverride ?? (pendingRuntimeContext
      ? `${prompt.trim()}\n\n${pendingRuntimeContext}`
      : prompt)).trim();
    if (!visibleContent || !runtimeContent || sending || !activeProject || activeProject.status !== "active") return;

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
      userMessage.attachments = attachments.map(({ dataUrl: _dataUrl, ...attachment }) => attachment);
      assistantMessage = createMessage(
        crypto.randomUUID(),
        "assistant",
        "",
        "streaming",
        new Date(startedAt.getTime() + 1).toISOString(),
      );
      const threadId = thread.id;
      const assistantId = assistantMessage.id;
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
            language: memberPreferences?.language ?? manifest.identity.language,
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
          },
        }),
      });
      await handleStream(response, threadId, assistantId);
      setAttachments([]);
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
              ? { content: error instanceof Error ? error.message : "Error desconegut" }
              : {}),
          }),
        ));
      } else {
        setNotice(error instanceof Error ? error.message : "No s’ha pogut crear el fil.");
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
    return succeeded;
  }, [activeProject, activeThread, attachments, composerEffort, composerMode, composerModel, handleStream, imageGeneration, initialWorkbench.persistence, manifest.identity.language, memberPreferences?.language, pendingRuntimeContext, preferences, prompt, selectedSkill, sending, webSearch]);

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
        throw new Error("No s’ha pogut desar l’aprovació.");
      }
      const updated = result.message as ChatMessage;
      setThreads((current) => updateThreadMessage(current, activeThreadId, message.id, () => updated));
      setNotice(action === "approved" ? "Resultat aprovat i desat." : "Resultat marcat com a pendent.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No s’ha pogut actualitzar el resultat.");
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
      setNotice("Aquesta aprovació ja no està pendent.");
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
      setNotice(error instanceof Error ? error.message : "No s’ha pogut actualitzar el projecte.");
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
      setNotice(error instanceof Error ? error.message : "No s’ha pogut actualitzar el fil.");
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
        setNotice(error instanceof Error ? error.message : "No s’ha pogut crear el projecte.");
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
            throw new Error("No s’ha pogut desar l’estat de la reversió.");
          }
          const updated = result.message as ChatMessage;
          setThreads((current) => updateThreadMessage(current, activeThreadId, target.id, () => updated));
        };
        await updateState("undo_waiting");
        setConfirmDialog(null);
        setActionBusy(false);
        const completed = await sendMessage(
          `Reverteix exclusivament els canvis d’aquest resultat. Abans d’acabar, comprova l’estat final i explica què s’ha restaurat.\n\nCanvis originals:\n${target.diff.slice(0, 10_000)}`,
          "Desfés els canvis d’aquest resultat i comprova que tot queda restaurat.",
        );
        setActionBusy(true);
        if (!completed) throw new Error("La reversió no s’ha pogut verificar.");
        await updateState("undo_complete");
        setNotice("Canvis revertits i verificats. L’estat ha quedat desat.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "No s’ha pogut completar la reversió.");
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
    window.enabled && (session.user.role === "owner" || window.id === "chat"));
  const inspectorEnabled = enabledWindows.some((window) => window.id === "inspector");
  const runtimeEnabled = enabledWindows.some((window) => window.id === "runtime");

  const openSideWindow = useCallback((windowId: SideWindowId) => {
    setActiveSideWindow((current) => current === windowId ? null : windowId);
  }, []);

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
      if (modifier && key === "n" && activeProject && !sending) {
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
      else if (automationsOpen) setAutomationsOpen(false);
      else if (customizationOpen) setCustomizationOpen(false);
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
    automationsOpen,
    commandPaletteOpen,
    confirmDialog,
    customizationOpen,
    mobileSidebarOpen,
    sending,
    startNewThread,
    textDialog,
  ]);

  const textDialogCopy = textDialog?.kind === "create-project"
    ? { title: "Nou projecte", label: "Nom del projecte", value: "", submit: "Crea projecte", maxLength: 80 }
    : textDialog?.kind === "rename-project"
      ? { title: "Reanomena el projecte", label: "Nom del projecte", value: textDialog.project.name, submit: "Desa", maxLength: 80 }
      : textDialog?.kind === "rename-thread"
        ? { title: "Reanomena el fil", label: "Títol del fil", value: textDialog.thread.title, submit: "Desa", maxLength: 120 }
        : null;

  return (
    <div style={style} className="flex h-[100dvh] overflow-hidden bg-[#f7f7f6] font-sans text-[#20201f]">
      <Sidebar
        productName={manifest.identity.productName}
        session={session}
        runtimeStatus={runtimeStatus}
        persistence={initialWorkbench.persistence}
        projects={projects}
        threads={threads}
        activeProjectId={activeProjectId}
        activeThreadId={activeThreadId}
        mobileOpen={mobileSidebarOpen}
        desktopOpen={desktopSidebarOpen}
        busy={actionBusy || sending}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onCloseDesktop={() => setDesktopSidebarOpen(false)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onSelectProject={selectProject}
        onSelectThread={selectThread}
        onNewThread={startNewThread}
        onNewProject={() => setTextDialog({ kind: "create-project" })}
        onProjectAction={handleProjectAction}
        onThreadAction={handleThreadAction}
        onOpenCustomization={() => setCustomizationOpen(true)}
        onOpenAutomations={() => {
          setActiveSideWindow(null);
          setCustomizationOpen(false);
          setCommandPaletteOpen(false);
          setAutomationsOpen(true);
        }}
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
        sending={sending}
        runtimeStatus={runtimeStatus}
        onPromptChange={setPrompt}
        onComposerModeChange={setComposerMode}
        onComposerModelChange={setComposerModel}
        onComposerEffortChange={setComposerEffort}
        onWebSearchChange={setWebSearch}
        onImageGenerationChange={setImageGeneration}
        onSelectedSkillChange={setSelectedSkill}
        onAttachmentsChange={setAttachments}
        onComposerNotice={setNotice}
        onSend={sendMessage}
        onStop={() => abortRef.current?.abort()}
        sidebarOpen={desktopSidebarOpen || mobileSidebarOpen}
        onToggleSidebar={toggleSidebar}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onOpenCustomization={() => setCustomizationOpen(true)}
        enabledWindows={enabledWindows}
        activeSideWindow={activeSideWindow}
        onOpenWindow={openSideWindow}
        canInspect={inspectorEnabled}
        onInspectMessage={inspectMessage}
        onResolveApproval={resolveApproval}
        onCreateVersion={(message) => void createVersionFromMessage(message)}
        onResultAction={persistResultAction}
        showAdvancedControls={session.user.role === "owner"}
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

      {session.user.role === "owner" && runtimeEnabled && activeSideWindow === "runtime" ? (
        <RuntimePanel
          manifest={manifest}
          session={session}
          status={runtimeStatus}
          onClose={() => setActiveSideWindow(null)}
        />
      ) : null}

      <CustomizationPanel
        productName={manifest.identity.productName}
        open={customizationOpen}
        preferences={preferences}
        onChange={changePreference}
        onReset={() => setPreferences(defaultPreferences)}
        onClose={() => setCustomizationOpen(false)}
      />

      <AutomationsPanel
        projectId={activeProject?.id ?? null}
        open={automationsOpen}
        onClose={() => setAutomationsOpen(false)}
      />

      <CommandPalette
        open={commandPaletteOpen}
        busy={actionBusy || sending}
        projects={projects}
        threads={threads}
        activeProjectId={activeProjectId}
        inspectorEnabled={inspectorEnabled}
        runtimeEnabled={runtimeEnabled}
        onClose={() => setCommandPaletteOpen(false)}
        onNewThread={startNewThread}
        onNewProject={() => setTextDialog({ kind: "create-project" })}
        onSelectProject={selectProject}
        onSelectThread={selectThread}
        onOpenInspector={() => setActiveSideWindow("inspector")}
        onOpenRuntime={() => setActiveSideWindow("runtime")}
        onOpenCustomization={() => setCustomizationOpen(true)}
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
        title={confirmDialog?.kind === "undo-result" ? "Vols desfer aquests canvis?" : confirmDialog?.kind === "archive-project" ? "Arxivar projecte?" : "Arxivar fil?"}
        description={confirmDialog?.kind === "archive-project"
          ? "El projecte i els seus fils deixaran d’aparèixer a la vista activa. Els podràs restaurar des d’Arxivats."
          : confirmDialog?.kind === "undo-result"
            ? "AiBrain revertirà només els canvis d’aquest resultat, comprovarà l’estat final i conservarà l’original a l’historial."
            : "El fil deixarà d’aparèixer a la llista activa. El podràs restaurar més endavant."}
        confirmLabel={confirmDialog?.kind === "undo-result" ? "Sí, desfés-los" : "Arxiva"}
        busy={actionBusy}
        onClose={() => !actionBusy && setConfirmDialog(null)}
        onConfirm={() => void confirmAction()}
      />

      {notice ? (
        <div role="status" aria-live="polite" className="fixed left-1/2 top-4 z-[90] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-[#d8d6d1] bg-[#fbfbf9] px-4 py-2.5 text-[10px] font-medium text-[#57544f] shadow-[0_18px_40px_-26px_rgba(0,0,0,.55)]">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
