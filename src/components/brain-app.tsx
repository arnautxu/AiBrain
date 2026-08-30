"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AuthSession } from "@/auth/types";
import { ChatWorkspace } from "@/components/chat-workspace";
import { BrowserPanel } from "@/components/browser-panel";
import { CommandPalette } from "@/components/command-palette";
import { CustomizationPanel } from "@/components/customization-panel";
import { DetailsPanel } from "@/components/details-panel";
import { DocumentPreviewPanel } from "@/components/document-preview-panel";
import { MemoryPanel } from "@/components/memory-panel";
import { ProjectPanel } from "@/components/project-panel";
import { LibraryPanel } from "@/components/library-panel";
import { TaskCenterPanel } from "@/components/task-center-panel";
import { useTaskCenterShortcut } from "@/components/use-task-center-shortcut";
import { AutomationsPanel } from "@/components/automations-panel";
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
  type DocumentArtifact,
  type ToolResult,
} from "@/lib/chat-contract";
import {
  loadManagedAppCapability,
  managedAppActionKey,
  resolveManagedAppAction,
  type ManagedAppActionDescriptor,
  type ManagedAppActionOutcome,
  type ManagedAppActionTarget,
} from "@/ui/codex-managed-app-ui";
import {
  consumeRecoverableChatStream,
  type ChatStreamRecoveryState,
} from "@/ui/recoverable-chat-stream";
import { createChatReattachRequest } from "@/ui/chat-reattach-request";
import {
  ClientTurnPerformance,
  type ClientTurnPerformanceReadback,
} from "@/ui/client-turn-performance";
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
  readBrowserStatus,
  shouldPresentBrowserPanel,
  type BrowserUiStatus,
} from "@/ui/browser-ui-adapter";
import {
  initialRuntimeStatus,
  isRuntimeStatus,
  type RuntimeStatus,
} from "@/lib/runtime-status";
import {
  resolveComposerExperience,
  type ComposerExperience,
} from "@/lib/composer-experience";
import {
  branchThreadRequest,
  createProjectRequest,
  createThreadRequest,
  updateProjectRequest,
  updateThreadRequest,
} from "@/lib/workbench-api-client";
import {
  isWorkbenchSnapshot,
  STANDALONE_PROJECT_SLUG,
  type BranchThreadInput,
  type UpdateProjectInput,
  type UpdateThreadInput,
  type WorkbenchProject,
  type WorkbenchSnapshot,
  type WorkbenchThread,
} from "@/workbench/types";
import type { PublicInstallationBranding } from "@/config/installation-branding";
import { isConnectorMention, type ConnectorMention } from "@/connectors/mentions-contract";
import { isSettingsSnapshot, type SettingsSnapshot } from "@/settings/contracts";
import {
  getThreadActivity,
  isThreadReadMarker,
  latestThreadReadMarker,
  type ThreadActivity,
  type ThreadReadMarker,
} from "@/workbench/thread-activity";
import {
  DEFAULT_TASK_NOTIFICATION_PREFERENCES,
  deriveTaskCenterItems,
  isTaskCenterPayload,
  type TaskCenterItem,
  type TaskCenterPayload,
  type TaskNotificationPreferences,
} from "@/task-center/contracts";

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

type StreamRecoveryNotice = {
  threadId: string;
  assistantMessageId: string;
  attempt: number;
};

type StoredSelection = {
  activeProjectId: string | null;
  threadByProject: Record<string, string>;
};

export type ManagedAppActionRegistry = Readonly<Record<string, ManagedAppActionDescriptor>>;

export function managedAppApprovalKey(locator: Pick<ManagedAppActionTarget, "threadId" | "turnId" | "itemId" | "approvalId"> | ApprovalItem) {
  return managedAppActionKey({
    threadId: locator.threadId,
    turnId: locator.turnId,
    itemId: locator.itemId,
    approvalId: "approvalId" in locator ? locator.approvalId : locator.id,
  });
}

export function rememberManagedAppAction(
  registry: ManagedAppActionRegistry,
  descriptor: ManagedAppActionDescriptor,
): ManagedAppActionRegistry {
  return { ...registry, [managedAppApprovalKey(descriptor.locator)]: descriptor };
}

export function managedAppActionForApproval(
  registry: ManagedAppActionRegistry,
  approval: ApprovalItem,
) {
  return registry[managedAppApprovalKey(approval)] ?? null;
}

export function forgetManagedAppAction(
  registry: ManagedAppActionRegistry,
  approval: ApprovalItem,
): ManagedAppActionRegistry {
  const key = managedAppApprovalKey(approval);
  if (!registry[key]) return registry;
  const { [key]: _removed, ...retained } = registry;
  return retained;
}

function managedAppOutcomeResult(approvalId: string, outcome: ManagedAppActionOutcome): ToolResult {
  const completed = outcome === "executed" || outcome === "replayed";
  return {
    id: `managed-app:${approvalId}`,
    kind: "app",
    title: "Acción conectada",
    status: completed ? "complete" : outcome === "denied" ? "stopped" : "failed",
    summary: outcome,
    output: null,
    sourceIds: [],
    createdAt: new Date().toISOString(),
  };
}

const MAX_CLIENT_TURN_READBACKS = 24;

function retainClientTurnReadback(
  current: Record<string, ClientTurnPerformanceReadback>,
  messageId: string,
  readback: ClientTurnPerformanceReadback,
) {
  const next = { ...current, [messageId]: readback };
  const ids = Object.keys(next);
  while (ids.length > MAX_CLIENT_TURN_READBACKS) {
    const oldest = ids.shift();
    if (oldest) delete next[oldest];
  }
  return next;
}

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
    sources: [],
    toolResults: [],
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

function loadThreadReadMarkers(key: string, threads: WorkbenchThread[]) {
  let stored: Record<string, ThreadReadMarker> = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (value && typeof value === "object" && !Array.isArray(value)) {
      stored = Object.fromEntries(Object.entries(value).filter(
        (entry): entry is [string, ThreadReadMarker] => isThreadReadMarker(entry[1]),
      ));
    }
  } catch {
    // A damaged marker cache is replaced with the visible snapshot below.
  }

  for (const thread of threads) {
    if (stored[thread.id]) continue;
    const marker = latestThreadReadMarker(thread);
    if (marker) stored[thread.id] = marker;
  }
  return stored;
}

function loadTaskCenterCache(key: string): TaskCenterPayload {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (isTaskCenterPayload(value)) return value;
  } catch {
    // Invalid browser-preview state is replaced by the empty safe default.
  }
  return {
    tasks: [],
    readTaskIds: [],
    preferences: DEFAULT_TASK_NOTIFICATION_PREFERENCES,
    continuity: "worker_required",
  };
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
    instructions: "",
    sources: [],
    memory: { enabled: true, notes: "", updatedAt: null },
    sharing: { visibility: "private", members: [] },
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

export function newThreadDestination(
  projects: readonly WorkbenchProject[],
  projectId?: string,
) {
  if (projectId) {
    return projects.find((project) => project.id === projectId && project.status === "active") ?? null;
  }
  return projects.find((project) =>
    project.slug === STANDALONE_PROJECT_SLUG && project.status === "active") ?? null;
}

function localBranchThread(parent: WorkbenchThread, input: BranchThreadInput) {
  const targetIndex = parent.messages.findIndex((message) => message.id === input.messageId);
  const target = parent.messages[targetIndex];
  if (!target) throw new Error("No se ha encontrado el mensaje.");
  let prefixEnd = targetIndex;
  let draftMessage: string | null = null;
  if (input.kind === "edit") {
    if (target.role !== "user" || !input.editedContent?.trim()) throw new Error("Este mensaje no se puede editar.");
    prefixEnd = targetIndex - 1;
    draftMessage = input.editedContent.trim();
  } else if (input.kind === "retry") {
    const userIndex = parent.messages.findLastIndex((message, index) => index < targetIndex && message.role === "user");
    if (target.role !== "assistant" || userIndex < 0) throw new Error("Esta respuesta no se puede regenerar.");
    prefixEnd = userIndex - 1;
    draftMessage = parent.messages[userIndex].content;
  } else if (target.role !== "assistant") throw new Error("La rama debe partir de una respuesta.");
  const suffix = input.kind === "edit" ? "editada" : input.kind === "retry" ? "regenerada" : "rama";
  return {
    thread: {
      ...localThread(parent.projectId, `${parent.title.replace(/ · (?:editada|regenerada|rama)$/u, "")} · ${suffix}`.slice(0, 120)),
      messages: structuredClone(parent.messages.slice(0, prefixEnd + 1)),
      lineage: { parentThreadId: parent.id, branchedFromMessageId: target.id, kind: input.kind },
    },
    draftMessage,
  };
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
  const threadReadKey = `aibrain.${session.tenant.id}.${session.user.id}.thread-read.v1`;
  const taskCenterKey = `aibrain.${session.tenant.id}.${session.user.id}.task-center.v1`;
  const [projects, setProjects] = useState(initialWorkbench.projects);
  const [threads, setThreads] = useState(initialWorkbench.threads);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<BrainPreferences>(() => preferencesFromManifest(manifest));
  const [prompt, setPrompt] = useState("");
  const [pendingRuntimeContext, setPendingRuntimeContext] = useState<string | null>(null);
  const [composerExperience, setComposerExperience] = useState<ComposerExperience>("smart");
  const [imageGeneration, setImageGeneration] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [connectorMentions, setConnectorMentions] = useState<ConnectorMention[]>([]);
  const [selectedConnectorMentionIds, setSelectedConnectorMentionIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ChatInputAttachment[]>([]);
  const [documents, setDocuments] = useState<StagedComposerDocument[]>([]);
  const [publications, setPublications] = useState<DocumentPublicationDraft[]>([]);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [runningThreadIds, setRunningThreadIds] = useState<Set<string>>(() => new Set());
  const [stoppingThreadIds, setStoppingThreadIds] = useState<Set<string>>(() => new Set());
  const [draftStarting, setDraftStarting] = useState(false);
  const [threadReadMarkers, setThreadReadMarkers] = useState<Record<string, ThreadReadMarker>>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [activeSideWindow, setActiveSideWindow] = useState<SideWindowId | null>(null);
  const [browserMonitorStatus, setBrowserMonitorStatus] = useState<BrowserUiStatus | null>(null);
  const autoOpenedBrowserDemandRef = useRef<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<DocumentArtifact | null>(null);
  const [customizationOpen, setCustomizationOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [taskCenterPayload, setTaskCenterPayload] = useState<TaskCenterPayload>({
    tasks: [],
    readTaskIds: [],
    preferences: DEFAULT_TASK_NOTIFICATION_PREFERENCES,
    continuity: "worker_required",
  });
  const [taskCenterBusy, setTaskCenterBusy] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(initialRuntimeStatus);
  const [settingsSnapshot, setSettingsSnapshot] = useState<SettingsSnapshot | null>(null);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [runtimeRetry, setRuntimeRetry] = useState(0);
  const [textDialog, setTextDialog] = useState<TextDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [streamRecoveryNotice, setStreamRecoveryNotice] = useState<StreamRecoveryNotice | null>(null);
  const [pendingBranchSend, setPendingBranchSend] = useState<{ threadId: string; content: string } | null>(null);
  const [managedAppAvailable, setManagedAppAvailable] = useState(false);
  const [managedAppActions, setManagedAppActions] = useState<ManagedAppActionRegistry>({});
  const [clientTurnReadbacks, setClientTurnReadbacks] = useState<Record<string, ClientTurnPerformanceReadback>>({});
  const threadByProjectRef = useRef<Record<string, string>>({});
  const turnControllersRef = useRef(new Map<string, {
    assistantMessageId: string;
    controller: AbortController;
  }>());
  const turnReservationsRef = useRef(new Set<string>());
  const activeSelectionRef = useRef<{ projectId: string | null; threadId: string | null }>({
    projectId: null,
    threadId: null,
  });
  const taskStatusRef = useRef(new Map<string, TaskCenterItem["status"]>());
  const taskPreferencesRef = useRef<TaskNotificationPreferences>(DEFAULT_TASK_NOTIFICATION_PREFERENCES);
  const taskCenterInitializedRef = useRef(false);

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
    setThreadReadMarkers(loadThreadReadMarkers(threadReadKey, snapshot.threads));
    if (initialWorkbench.persistence === "browser-preview") {
      const taskCenter = loadTaskCenterCache(taskCenterKey);
      setTaskCenterPayload(taskCenter);
      taskPreferencesRef.current = taskCenter.preferences;
    }
    threadByProjectRef.current = savedSelection.threadByProject;
    if (project && thread) threadByProjectRef.current[project.id] = thread.id;
    setHydrated(true);
  }, [defaultPreferences, initialWorkbench, preferencesKey, previewKey, selectionKey, taskCenterKey, threadReadKey]);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    void loadManagedAppCapability(fetch).then((available) => {
      if (active) setManagedAppAvailable(available);
    }).catch(() => {
      if (active) setManagedAppAvailable(false);
    });
    return () => { active = false; };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || initialWorkbench.persistence === "browser-preview") return;
    const controller = new AbortController();
    void fetch("/api/connectors/mentions", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value: unknown) => {
        const mentions = value && typeof value === "object" && "mentions" in value ? (value as { mentions?: unknown }).mentions : null;
        if (Array.isArray(mentions) && mentions.every(isConnectorMention)) setConnectorMentions(mentions);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [hydrated, initialWorkbench.persistence]);

  useEffect(() => {
    setSelectedConnectorMentionIds((current) => current.filter((id) => connectorMentions.some((mention) => mention.id === id && mention.canRead)));
  }, [connectorMentions]);

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
    activeSelectionRef.current = { projectId: activeProjectId, threadId: activeThreadId };
  }, [activeProjectId, activeThreadId]);

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
  const activeBrowserDemandKey = useMemo(() => {
    const latestAssistant = activeThread?.messages.findLast((message) => message.role === "assistant") ?? null;
    if (!latestAssistant) return null;
    const activity = latestAssistant.activity.findLast((item) => item.detail === "aibrain_browser");
    if (activity) return `${latestAssistant.id}:${activity.id}`;
    const result = latestAssistant.toolResults?.findLast((item) => item.kind === "browser");
    return result ? `${latestAssistant.id}:${result.id}` : null;
  }, [activeThread]);
  const resolvedComposerExperience = useMemo(
    () => resolveComposerExperience(composerExperience),
    [composerExperience],
  );
  const threadActivityById = useMemo(() => Object.fromEntries(threads.map((thread) => [
    thread.id,
    getThreadActivity(
      thread,
      threadReadMarkers[thread.id] ?? null,
      runningThreadIds.has(thread.id),
    ),
  ])) as Record<string, ThreadActivity>, [runningThreadIds, threadReadMarkers, threads]);
  const sending = activeThread
    ? runningThreadIds.has(activeThread.id) || activeThread.messages.some((message) =>
        message.role === "assistant" && message.status === "streaming")
    : draftStarting;
  const selectedMessage = useMemo(
    () => activeThread?.messages.find((message) => message.id === selectedMessageId) ??
      activeThread?.messages.findLast((message) => message.role === "assistant") ?? null,
    [activeThread, selectedMessageId],
  );

  useEffect(() => {
    if (!previewDocument) return;
    const remainsInConversation = activeThread?.messages.some((message) =>
      message.artifacts.some((artifact) => artifact.id === previewDocument.id)) ?? false;
    if (!remainsInConversation) setPreviewDocument(null);
  }, [activeThread, previewDocument]);
  const taskCenterItems = useMemo(() => {
    const local = deriveTaskCenterItems({ projects, threads }, taskCenterPayload.readTaskIds);
    const merged = initialWorkbench.persistence === "browser-preview"
      ? new Map(taskCenterPayload.tasks.map((task) => [task.id, task]))
      : new Map(local.map((task) => [task.id, task]));
    for (const task of initialWorkbench.persistence === "browser-preview" ? local : taskCenterPayload.tasks) {
      merged.set(task.id, task);
    }
    return [...merged.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
  }, [initialWorkbench.persistence, projects, taskCenterPayload.readTaskIds, taskCenterPayload.tasks, threads]);
  const taskSummary = useMemo(() => ({
    unread: taskCenterItems.filter((task) => task.unread).length,
    running: taskCenterItems.filter((task) => task.status === "running").length,
    needsAttention: taskCenterItems.filter((task) => task.status === "needs_attention").length,
  }), [taskCenterItems]);

  const applyTaskCenterPayload = useCallback((payload: TaskCenterPayload, notify = true) => {
    const previous = taskStatusRef.current;
    const shouldNotify = taskCenterInitializedRef.current && notify;
    const fresh = shouldNotify ? payload.tasks.filter((task) => {
      if (!task.unread || task.threadId === activeSelectionRef.current.threadId) return false;
      const prior = previous.get(task.id);
      return prior === "running" || (prior === undefined && task.status !== "running");
    }) : [];
    taskStatusRef.current = new Map(payload.tasks.map((task) => [task.id, task.status]));
    taskCenterInitializedRef.current = true;
    taskPreferencesRef.current = payload.preferences;
    setTaskCenterPayload(payload);

    const newest = fresh[0];
    if (!newest) return;
    if (payload.preferences.inApp) {
      setNotice(newest.status === "needs_attention"
        ? `Una tarea necesita tu atención: ${newest.threadTitle}`
        : newest.status === "completed"
          ? `Tarea completada: ${newest.threadTitle}`
          : `Una tarea ha terminado con error: ${newest.threadTitle}`);
    }
    if (payload.preferences.desktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const notification = new Notification(
        newest.status === "needs_attention" ? `${branding.productName} necesita tu atención` :
          newest.status === "completed" ? `${branding.productName} ha terminado una tarea` : `Una tarea de ${branding.productName} ha fallado`,
        { body: newest.threadTitle, tag: newest.id },
      );
      notification.onclick = () => {
        window.focus();
        setTaskCenterOpen(true);
        notification.close();
      };
    }
  }, [branding.productName]);

  const refreshTaskCenter = useCallback(async (notify = true) => {
    const response = await fetch("/api/task-center", { cache: "no-store" });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok || !isTaskCenterPayload(value)) throw new Error("No se ha podido actualizar el centro de tareas.");
    applyTaskCenterPayload(value, notify);
    return value;
  }, [applyTaskCenterPayload]);

  useEffect(() => {
    if (typeof Notification !== "undefined") setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (!hydrated || initialWorkbench.persistence === "browser-preview") return;
    void refreshTaskCenter(false).catch(() => {
      setNotice("El historial de tareas no se ha podido sincronizar. Tus conversaciones siguen disponibles.");
    });
  }, [hydrated, initialWorkbench.persistence, refreshTaskCenter]);

  useEffect(() => {
    if (!hydrated || initialWorkbench.persistence !== "browser-preview") return;
    taskStatusRef.current = new Map(taskCenterItems.map((task) => [task.id, task.status]));
    taskCenterInitializedRef.current = true;
  }, [hydrated, initialWorkbench.persistence, taskCenterItems]);

  useEffect(() => {
    if (!hydrated || initialWorkbench.persistence === "browser-preview") return;
    const refresh = () => void refreshTaskCenter(true).catch(() => undefined);
    const interval = window.setInterval(refresh, taskSummary.running ? 5_000 : 30_000);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hydrated, initialWorkbench.persistence, refreshTaskCenter, taskSummary.running]);

  useEffect(() => {
    taskPreferencesRef.current = taskCenterPayload.preferences;
    if (!hydrated || initialWorkbench.persistence !== "browser-preview") return;
    localStorage.setItem(taskCenterKey, JSON.stringify({ ...taskCenterPayload, tasks: taskCenterItems }));
  }, [hydrated, initialWorkbench.persistence, taskCenterItems, taskCenterKey, taskCenterPayload]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(threadReadKey, JSON.stringify(threadReadMarkers));
  }, [hydrated, threadReadKey, threadReadMarkers]);

  useEffect(() => {
    if (!activeThread) return;
    const marker = latestThreadReadMarker(activeThread);
    if (!marker) return;
    setThreadReadMarkers((current) => {
      const previous = current[activeThread.id];
      if (previous?.messageId === marker.messageId && previous.phase === marker.phase) return current;
      return { ...current, [activeThread.id]: marker };
    });
  }, [activeThread]);

  useEffect(() => () => {
    for (const run of turnControllersRef.current.values()) run.controller.abort();
    turnControllersRef.current.clear();
    turnReservationsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!hydrated || !networkOnline) return;
    const controller = new AbortController();
    let disposed = false;
    let retryTimer: number | undefined;
    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      const retryAfterMs = Math.min(30_000, 2_000 * (2 ** Math.min(runtimeRetry, 4)));
      retryTimer = window.setTimeout(() => {
        if (!disposed && navigator.onLine) setRuntimeRetry((current) => current + 1);
      }, retryAfterMs);
    };
    const timeout = window.setTimeout(() => {
      if (disposed) return;
      setRuntimeStatus((current) => ({ ...current, codex: "unavailable", ready: false }));
      controller.abort();
      scheduleRetry();
    // The server caps this request at 35 seconds. Keep the browser deadline
    // slightly above it so a cold, valid Codex worker can report its result.
    }, 40_000);
    const query = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : "";
    setRuntimeStatus((current) => ({ ...current, codex: "checking", ready: false }));
    void fetch(`/api/runtime/status${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((status: unknown) => {
        if (isRuntimeStatus(status)) {
          setRuntimeStatus(status);
          if (status.mode === "codex" && !status.ready) scheduleRetry();
        } else {
          setRuntimeStatus((current) => ({ ...current, codex: "unavailable", ready: false }));
          scheduleRetry();
        }
      })
      .catch(() => {
        if (!disposed) {
          setRuntimeStatus((current) => ({ ...current, codex: "unavailable", ready: false }));
          scheduleRetry();
        }
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      if (retryTimer) window.clearTimeout(retryTimer);
      controller.abort();
    };
  }, [activeProjectId, hydrated, networkOnline, runtimeRetry]);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    void fetch("/api/settings", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value: unknown) => {
        if (isSettingsSnapshot(value)) setSettingsSnapshot(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [hydrated]);

  const effectiveRuntimeStatus = useMemo<RuntimeStatus>(() => {
    const enabled = (id: string) => settingsSnapshot?.apps.find((app) => app.id === id)?.effectiveEnabled ?? true;
    return {
      ...runtimeStatus,
      capabilities: {
        ...runtimeStatus.capabilities,
        webSearch: runtimeStatus.mode === "demo" || runtimeStatus.ready,
        imageGeneration: runtimeStatus.capabilities.imageGeneration && enabled("image-generation"),
      },
      skills: enabled("skills") ? runtimeStatus.skills : [],
    };
  }, [runtimeStatus, settingsSnapshot]);

  const appPolicy = useMemo(() => ({
    imageGeneration: settingsSnapshot?.apps.find((app) => app.id === "image-generation")?.effectiveEnabled ?? true,
    skills: settingsSnapshot?.apps.find((app) => app.id === "skills")?.effectiveEnabled ?? true,
  }), [settingsSnapshot]);

  useEffect(() => {
    if (!appPolicy.imageGeneration || (runtimeStatus.mode === "codex" && runtimeStatus.codex !== "checking" && !runtimeStatus.capabilities.imageGeneration)) setImageGeneration(false);
    if (!appPolicy.skills || (runtimeStatus.mode === "codex" && runtimeStatus.codex !== "checking" && selectedSkill && !runtimeStatus.skills.some((skill) => skill.id === selectedSkill))) setSelectedSkill(null);
  }, [appPolicy, runtimeStatus, selectedSkill]);

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
    if (documentUploading) {
      setNotice("Espera a que termine de prepararse el documento antes de cambiar de proyecto.");
      return;
    }
    const project = projects.find((candidate) => candidate.id === projectId && candidate.status === "active");
    if (!project) return;
    if (activeProjectId && activeThreadId) threadByProjectRef.current[activeProjectId] = activeThreadId;
    const rememberedId = threadByProjectRef.current[projectId];
    const remembered = threads.find((thread) =>
      thread.id === rememberedId && thread.projectId === projectId && thread.status === "active");
    const thread = remembered ?? firstActiveThread(threads, projectId);
    activeSelectionRef.current = { projectId, threadId: thread?.id ?? null };
    setActiveProjectId(projectId);
    setActiveThreadId(thread?.id ?? null);
    setPendingRuntimeContext(null);
    setAttachments([]);
    setDocuments([]);
    setSelectedMessageId(null);
    setActiveSideWindow(null);
    setMobileSidebarOpen(false);
  }, [activeProjectId, activeThreadId, documentUploading, projects, threads]);

  const selectThread = useCallback((threadId: string) => {
    if (documentUploading) {
      setNotice("Espera a que termine de prepararse el documento antes de cambiar de conversación.");
      return;
    }
    const thread = threads.find((candidate) => candidate.id === threadId && candidate.status === "active");
    if (!thread) return;
    activeSelectionRef.current = { projectId: thread.projectId, threadId: thread.id };
    setActiveProjectId(thread.projectId);
    setActiveThreadId(thread.id);
    setPendingRuntimeContext(null);
    setAttachments([]);
    setDocuments([]);
    threadByProjectRef.current[thread.projectId] = thread.id;
    setSelectedMessageId(null);
    setMobileSidebarOpen(false);
  }, [documentUploading, threads]);

  const updateTaskCenter = useCallback(async (
    body: { action: "mark_read"; taskIds: string[] } |
      { action: "preferences"; preferences: TaskNotificationPreferences },
  ) => {
    setTaskCenterBusy(true);
    try {
      if (initialWorkbench.persistence === "browser-preview") {
        setTaskCenterPayload((current) => {
          if (body.action === "preferences") {
            taskPreferencesRef.current = body.preferences;
            return { ...current, preferences: body.preferences };
          }
          const readTaskIds = [...new Set([...current.readTaskIds, ...body.taskIds])];
          return {
            ...current,
            readTaskIds,
            tasks: current.tasks.map((task) => body.taskIds.includes(task.id)
              ? { ...task, unread: false }
              : task),
          };
        });
        return;
      }
      const response = await fetch("/api/task-center", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isTaskCenterPayload(value)) {
        throw new Error("No se ha podido guardar el centro de tareas.");
      }
      applyTaskCenterPayload(value, false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido guardar el centro de tareas.");
    } finally {
      setTaskCenterBusy(false);
    }
  }, [applyTaskCenterPayload, initialWorkbench.persistence]);

  const markTaskRead = useCallback((taskId: string) => {
    void updateTaskCenter({ action: "mark_read", taskIds: [taskId] });
  }, [updateTaskCenter]);

  const markAllTasksRead = useCallback(() => {
    const taskIds = taskCenterItems.filter((task) => task.unread).map((task) => task.id);
    if (taskIds.length) void updateTaskCenter({ action: "mark_read", taskIds });
  }, [taskCenterItems, updateTaskCenter]);

  const requestDesktopNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      void updateTaskCenter({
        action: "preferences",
        preferences: { ...taskPreferencesRef.current, desktop: true },
      });
    } else {
      setNotice("Los avisos del navegador no se han activado.");
    }
  }, [updateTaskCenter]);

  const openTaskConversation = useCallback(async (task: TaskCenterItem) => {
    if (task.unread) markTaskRead(task.id);
    setTaskCenterOpen(false);
    selectThread(task.threadId);
    if (initialWorkbench.persistence === "browser-preview") return;
    try {
      const response = await fetch("/api/workbench", { cache: "no-store" });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !value || typeof value !== "object" || !("workbench" in value) ||
        !isWorkbenchSnapshot(value.workbench)) return;
      setProjects(value.workbench.projects);
      setThreads(value.workbench.threads);
    } catch {
      // The already loaded conversation remains usable if this refresh fails.
    }
  }, [initialWorkbench.persistence, markTaskRead, selectThread]);

  const startNewThread = useCallback((projectId?: string) => {
    if (documentUploading) return;
    const destination = newThreadDestination(projects, projectId);
    if (!destination) {
      setNotice("No se ha podido preparar el espacio de conversaciones.");
      return;
    }
    delete threadByProjectRef.current[destination.id];
    activeSelectionRef.current = { projectId: destination.id, threadId: null };
    setActiveProjectId(destination.id);
    setActiveThreadId(null);
    setSelectedMessageId(null);
    setPrompt("");
    setPendingRuntimeContext(null);
    setAttachments([]);
    setDocuments([]);
    setActiveSideWindow(null);
    setMobileSidebarOpen(false);
  }, [documentUploading, projects]);

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
    request: (signal: AbortSignal) => Promise<Response>,
    threadId: string,
    assistantMessageId: string,
    signal: AbortSignal,
    performance: ClientTurnPerformance,
    startedAt: number,
  ) => {
    const dispatcher = createChatEventFrameDispatcher((event) => {
      setThreads((current) => updateThreadMessage(
        current,
        threadId,
        assistantMessageId,
        (message) => applyChatStreamEvent(message, event),
      ));
    }, undefined, { onEventApplied: (event) => performance.eventApplied(event) });
    try {
      await consumeRecoverableChatStream({
        request,
        signal,
        startedAt,
        onEvent: dispatcher.dispatch,
        onMeasurement: (measurement) => performance.transportMeasured(measurement),
        onAccepted: () => {
          dispatcher.dispatch({
            type: "activity",
            item: {
              id: "client-request-status",
              kind: "system",
              label: "Solicitud aceptada",
              status: "complete",
            },
          });
          performance.feedbackApplied("accepted");
        },
        onRecoveryState: (state: ChatStreamRecoveryState) => {
          if (state.state === "recovering") {
            performance.reconnectStarted();
            return;
          }
          if (state.state === "stalled") {
            setStreamRecoveryNotice({ threadId, assistantMessageId, attempt: state.attempt });
            return;
          }
          setStreamRecoveryNotice((current) => current?.threadId === threadId &&
            current.assistantMessageId === assistantMessageId ? null : current);
        },
      });
    } finally {
      dispatcher.close();
      setStreamRecoveryNotice((current) => current?.threadId === threadId &&
        current.assistantMessageId === assistantMessageId ? null : current);
    }
  }, []);

  const sendMessage = useCallback(async (messageOverride?: string, displayMessageOverride?: string) => {
    const visibleContent = (displayMessageOverride ?? messageOverride ?? prompt).trim();
    const runtimeContent = (messageOverride ?? (pendingRuntimeContext
      ? `${prompt.trim()}\n\n${pendingRuntimeContext}`
      : prompt)).trim();
    if (!visibleContent || !runtimeContent || sending || documentUploading || !activeProject || activeProject.status !== "active") return;

    const initialThreadId = activeThread?.id ?? null;
    const selectionAtStart = {
      projectId: activeProject.id,
      threadId: initialThreadId,
    };
    const reservationKey = initialThreadId ?? `project:${activeProject.id}:new`;
    if (turnReservationsRef.current.has(reservationKey)) return;
    turnReservationsRef.current.add(reservationKey);
    const sendIntentAt = performance.now();
    if (!initialThreadId) setDraftStarting(true);
    let thread = activeThread && activeThread.status === "active" &&
      activeThread.projectId === activeProject.id ? activeThread : null;
    let assistantMessage: ChatMessage | null = null;
    let controller: AbortController | null = null;
    let clientTurnPerformance: ClientTurnPerformance | null = null;
    let ownsVisibleComposer = true;
    let succeeded = false;
    try {
      if (!thread) {
        const title = titleFromMessage(visibleContent);
        thread = initialWorkbench.persistence === "browser-preview"
          ? localThread(activeProject.id, title)
          : await createThreadRequest(activeProject.id, title);
        setDraftStarting(false);
        setThreads((current) => [thread as WorkbenchThread, ...current]);
        ownsVisibleComposer = activeSelectionRef.current.projectId === selectionAtStart.projectId &&
          activeSelectionRef.current.threadId === selectionAtStart.threadId;
        if (ownsVisibleComposer) {
          activeSelectionRef.current = { projectId: activeProject.id, threadId: thread.id };
          setActiveThreadId(thread.id);
          threadByProjectRef.current[activeProject.id] = thread.id;
        }
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
      assistantMessage.activity = [{
        id: "client-request-status",
        kind: "system",
        label: "Enviando solicitud",
        status: "running",
      }];
      const threadId = thread.id;
      const assistantId = assistantMessage.id;
      clientTurnPerformance = new ClientTurnPerformance(
        (readback) => setClientTurnReadbacks((current) => retainClientTurnReadback(current, assistantId, readback)),
        undefined,
        sendIntentAt,
      );
      setRunningThreadIds((current) => {
        const next = new Set(current);
        next.add(threadId);
        return next;
      });
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
      clientTurnPerformance.feedbackApplied("local");
      if (ownsVisibleComposer) {
        setSelectedMessageId(assistantId);
        setPrompt("");
        setPendingRuntimeContext(null);
        setAttachments([]);
        setDocuments([]);
        setSelectedConnectorMentionIds([]);
      }

      controller = new AbortController();
      turnControllersRef.current.set(threadId, {
        assistantMessageId: assistantId,
        controller,
      });
      const streamRequestedAt = performance.now();
      // This serialized request is deliberately reused verbatim for every
      // reattach, preserving the server's idempotency key and turn identity.
      const chatRequest = JSON.stringify({
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
          mode: "agent",
          experience: composerExperience,
          model: resolvedComposerExperience.model,
          effort: resolvedComposerExperience.effort,
          webSearch: true,
          imageGeneration,
          skill: selectedSkill,
          ...(selectedConnectorMentionIds.length ? { connectorMentions: selectedConnectorMentionIds } : {}),
          attachments,
          ...(readyDocuments.length ? { documentUploadIds: readyDocuments.map((document) => document.uploadId) } : {}),
        },
      });
      await handleStream(createChatReattachRequest(chatRequest), threadId, assistantId, controller.signal, clientTurnPerformance, streamRequestedAt);
      succeeded = true;
    } catch (error) {
      if (thread && assistantMessage) {
        const stopped = controller?.signal.aborted === true;
        clientTurnPerformance?.terminalStateApplied(stopped ? "stopped" : "error");
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
      if (thread) {
        const threadId = thread.id;
        if (controller && turnControllersRef.current.get(threadId)?.controller === controller) {
          turnControllersRef.current.delete(threadId);
        }
        setRunningThreadIds((current) => {
          if (!current.has(threadId)) return current;
          const next = new Set(current);
          next.delete(threadId);
          return next;
        });
      }
      turnReservationsRef.current.delete(reservationKey);
      if (!initialThreadId) setDraftStarting(false);
    }
    return succeeded;
  }, [activeProject, activeThread, attachments, composerExperience, documentUploading, documents, handleStream, imageGeneration, initialWorkbench.persistence, manifest.identity.language, pendingRuntimeContext, preferences, prompt, resolvedComposerExperience, selectedConnectorMentionIds, selectedSkill, sending]);

  const branchConversation = useCallback(async (
    message: ChatMessage,
    input: BranchThreadInput,
    autoSend: boolean,
  ) => {
    if (!activeThread || sending || actionBusy) return;
    setActionBusy(true);
    try {
      const result = initialWorkbench.persistence === "browser-preview"
        ? localBranchThread(activeThread, input)
        : await branchThreadRequest(activeThread.id, input);
      setThreads((current) => [result.thread, ...current]);
      setActiveProjectId(result.thread.projectId);
      setActiveThreadId(result.thread.id);
      threadByProjectRef.current[result.thread.projectId] = result.thread.id;
      setSelectedMessageId(null);
      setPrompt(result.draftMessage ?? "");
      setPendingRuntimeContext(null);
      setAttachments([]);
      setDocuments([]);
      setActiveSideWindow(null);
      if (autoSend && result.draftMessage) {
        setPendingBranchSend({ threadId: result.thread.id, content: result.draftMessage });
      } else {
        setNotice("Rama creada. La conversación original se conserva intacta.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido crear la rama.");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, activeThread, initialWorkbench.persistence, sending]);

  useEffect(() => {
    if (!pendingBranchSend || pendingBranchSend.threadId !== activeThreadId || sending || actionBusy) return;
    const pending = pendingBranchSend;
    setPendingBranchSend(null);
    void sendMessage(pending.content);
  }, [actionBusy, activeThreadId, pendingBranchSend, sendMessage, sending]);

  const stopActiveTurn = useCallback(async () => {
    const activeRun = activeThread ? turnControllersRef.current.get(activeThread.id) : null;
    const controller = activeRun?.controller;
    const activeAssistant = activeThread
      ? [...activeThread.messages].reverse().find((message) =>
          message.role === "assistant" && message.status === "streaming" &&
          (!activeRun || message.id === activeRun.assistantMessageId))
      : null;
    if (initialWorkbench.persistence !== "filesystem" || !activeThread || !activeAssistant) {
      controller?.abort();
      return;
    }
    if (stoppingThreadIds.has(activeThread.id)) return;
    setStoppingThreadIds((current) => new Set(current).add(activeThread.id));
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
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message = payload && typeof payload === "object" && "error" in payload &&
          typeof payload.error === "string"
          ? payload.error
          : "No s’ha pogut confirmar l’aturada amb el runtime.";
        setNotice(message);
      }
    } catch {
      setNotice("S’ha perdut la connexió mentre s’aturava el torn.");
    } finally {
      controller?.abort();
      setStoppingThreadIds((current) => {
        const next = new Set(current);
        next.delete(activeThread.id);
        return next;
      });
    }
  }, [activeThread, initialWorkbench.persistence, stoppingThreadIds]);

  const resolveApproval = useCallback(async (
    messageId: string,
    selectedApproval: ApprovalItem,
    decision: ApprovalDecision,
  ) => {
    if (!activeThreadId) return;
    const managedAppAction = managedAppActionForApproval(managedAppActions, selectedApproval);
    if (managedAppAction) {
      if (managedAppAction.locator.threadId !== activeThreadId || managedAppAction.locator.turnId !== messageId) {
        setNotice("La acción conectada ya no corresponde a esta conversación.");
        return;
      }
      const result = await resolveManagedAppAction(fetch, managedAppAction, {
        threadId: activeThreadId,
        turnId: messageId,
      }, decision);
      if (result.state === "recoverable") {
        setNotice(result.stage === "current-thread"
          ? "Vuelve a la conversación original para resolver esta acción conectada."
          : "La acción conectada sigue pendiente. Puedes volver a intentarlo.");
        return;
      }
      setManagedAppActions((current) => forgetManagedAppAction(current, selectedApproval));
      setThreads((current) => updateThreadMessage(current, activeThreadId, messageId, (message) => ({
        ...message,
        approvals: message.approvals.map((approval) => approval.id === selectedApproval.id ? result.approval : approval),
        toolResults: [
          ...(message.toolResults ?? []).filter((item) => item.id !== `managed-app:${selectedApproval.id}`),
          managedAppOutcomeResult(selectedApproval.id, result.outcome),
        ],
      })));
      return;
    }
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
  }, [activeThreadId, managedAppActions]);

  const prepareManagedAppAction = useCallback((descriptor: ManagedAppActionDescriptor) => {
    if (!activeThreadId || descriptor.locator.threadId !== activeThreadId ||
        descriptor.locator.turnId !== descriptor.approval.turnId) return;
    setThreads((current) => updateThreadMessage(current, activeThreadId, descriptor.locator.turnId, (message) => ({
      ...message,
      approvals: [
        ...message.approvals.filter((approval) => approval.id !== descriptor.approval.id),
        descriptor.approval,
      ],
    })));
    setManagedAppActions((current) => rememberManagedAppAction(current, descriptor));
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
            ...patch,
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
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
    if (action === "archive" && threads.some((thread) =>
      thread.projectId === project.id &&
      (threadActivityById[thread.id]?.state === "running" ||
        threadActivityById[thread.id]?.state === "needs_attention"))) {
      setNotice("Detén o resuelve las conversaciones en curso antes de archivar el proyecto.");
      return;
    }
    if (action === "rename") setTextDialog({ kind: "rename-project", project });
    else if (action === "archive") setConfirmDialog({ kind: "archive-project", project });
    else if (action === "restore") void persistProjectPatch(project, { status: "active" });
    else void persistProjectPatch(project, { pinned: action === "pin" });
  }, [persistProjectPatch, threadActivityById, threads]);

  const handleThreadAction = useCallback((thread: WorkbenchThread, action: ThreadMenuAction) => {
    const workState = threadActivityById[thread.id]?.state;
    if (action === "archive" && (workState === "running" || workState === "needs_attention")) {
      setNotice("Detén o resuelve esta conversación antes de archivarla.");
      return;
    }
    if (action === "rename") setTextDialog({ kind: "rename-thread", thread });
    else if (action === "archive") setConfirmDialog({ kind: "archive-thread", thread });
    else if (action === "restore") void persistThreadPatch(thread, { status: "active" });
    else void persistThreadPatch(thread, { pinned: action === "pin" });
  }, [persistThreadPatch, threadActivityById]);

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

  const changePreference = useCallback(
    <Key extends keyof BrainPreferences>(key: Key, value: BrainPreferences[Key]) => {
      setPreferences((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const enabledWindows = manifest.windows.filter((window) =>
    window.enabled && (window.id === "chat" || window.id === "inspector" || window.id === "browser"));
  const inspectorEnabled = enabledWindows.some((window) => window.id === "inspector");
  const browserDeclared = enabledWindows.some((window) => window.id === "browser");
  const browserSetting = settingsSnapshot?.apps.find((app) => app.id === "managed-browser") ?? null;
  const browserEnabled = browserDeclared &&
    (browserSetting ? browserSetting.effectiveEnabled === true : browserMonitorStatus?.available === true);

  useEffect(() => {
    if (!browserDeclared || !activeBrowserDemandKey || !activeThreadId ||
        autoOpenedBrowserDemandRef.current === activeBrowserDemandKey) return;
    const controller = new AbortController();
    let interval: number | null = null;
    const refresh = () => {
      void readBrowserStatus(controller.signal).then((status) => {
        setBrowserMonitorStatus(status);
        if (!shouldPresentBrowserPanel(status, true)) return;
        setActiveSideWindow((current) => {
          if (current && current !== "browser") return current;
          autoOpenedBrowserDemandRef.current = activeBrowserDemandKey;
          if (interval !== null) window.clearInterval(interval);
          return "browser";
        });
      }).catch(() => {
        if (!controller.signal.aborted) setBrowserMonitorStatus(null);
      });
    };
    refresh();
    interval = window.setInterval(refresh, 750);
    return () => {
      controller.abort();
      if (interval !== null) window.clearInterval(interval);
    };
  }, [activeBrowserDemandKey, activeThreadId, browserDeclared]);

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setDesktopSidebarOpen((current) => !current);
      return;
    }
    setMobileSidebarOpen((current) => !current);
  }, []);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 768px)");
    const closeMobileSidebar = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileSidebarOpen(false);
    };
    if (desktopQuery.matches) setMobileSidebarOpen(false);
    desktopQuery.addEventListener("change", closeMobileSidebar);
    return () => desktopQuery.removeEventListener("change", closeMobileSidebar);
  }, []);

  const toggleTaskCenter = useCallback(() => {
    setTaskCenterOpen((current) => !current);
  }, []);

  useTaskCenterShortcut(toggleTaskCenter);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLocaleLowerCase("ca");
      if (modifier && key === "k") {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
        return;
      }
      if (modifier && key === "n") {
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
      else if (libraryOpen) setLibraryOpen(false);
      else if (taskCenterOpen) setTaskCenterOpen(false);
      else if (automationsOpen) setAutomationsOpen(false);
      else if (textDialog && !actionBusy) setTextDialog(null);
      else if (confirmDialog && !actionBusy) setConfirmDialog(null);
      else if (previewDocument) setPreviewDocument(null);
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
    libraryOpen,
    taskCenterOpen,
    automationsOpen,
    mobileSidebarOpen,
    previewDocument,
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
        busy={actionBusy}
        threadActivityById={threadActivityById}
        taskSummary={taskSummary}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onCloseDesktop={() => setDesktopSidebarOpen(false)}
        onOpenDesktop={() => setDesktopSidebarOpen(true)}
        onOpenCommandPalette={() => { setMobileSidebarOpen(false); setCommandPaletteOpen(true); }}
        onOpenLibrary={() => { setMobileSidebarOpen(false); setLibraryOpen(true); }}
        onOpenTaskCenter={() => { setMobileSidebarOpen(false); setTaskCenterOpen(true); }}
        onOpenAutomations={() => { setMobileSidebarOpen(false); setAutomationsOpen(true); }}
        onSelectProject={(projectId) => { setAutomationsOpen(false); selectProject(projectId); }}
        onSelectThread={(threadId) => { setAutomationsOpen(false); selectThread(threadId); }}
        onNewThread={(projectId) => { setAutomationsOpen(false); startNewThread(projectId); }}
        onNewProject={() => { setMobileSidebarOpen(false); setTextDialog({ kind: "create-project" }); }}
        onProjectAction={handleProjectAction}
        onThreadAction={handleThreadAction}
        onOpenCustomization={() => { setMobileSidebarOpen(false); setCustomizationOpen(true); }}
      />

      {automationsOpen ? <AutomationsPanel
        open
        projects={projects}
        fullPage
        onClose={() => setAutomationsOpen(false)}
        onOpenTaskCenter={() => { setAutomationsOpen(false); setTaskCenterOpen(true); }}
        onOpenThread={(threadId) => { setAutomationsOpen(false); selectThread(threadId); }}
      /> : <ChatWorkspace
        manifest={manifest}
        preferences={preferences}
        project={activeProject}
        thread={activeThread}
        projects={projects}
        userName={session.user.name}
        companyName={branding.companyName}
        assistantName={branding.productName}
        hydrated={hydrated}
        prompt={prompt}
        composerExperience={composerExperience}
        imageGeneration={imageGeneration}
        connectorMentions={connectorMentions}
        selectedConnectorMentionIds={selectedConnectorMentionIds}
        attachments={attachments}
        documents={documents}
        publications={publications}
        documentUploading={documentUploading}
        sending={sending}
        stopping={activeThread ? stoppingThreadIds.has(activeThread.id) : false}
        runtimeStatus={effectiveRuntimeStatus}
        appPolicy={appPolicy}
        networkOnline={networkOnline}
        streamRecovery={streamRecoveryNotice?.threadId === activeThreadId
          ? { attempt: streamRecoveryNotice.attempt }
          : null}
        onRetryRuntime={() => setRuntimeRetry((current) => current + 1)}
        onPromptChange={setPrompt}
        onComposerExperienceChange={setComposerExperience}
        onDestinationChange={startNewThread}
        onImageGenerationChange={setImageGeneration}
        onConnectorMentionIdsChange={setSelectedConnectorMentionIds}
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
        onResolveApproval={resolveApproval}
        onEditMessage={(message, content) => void branchConversation(message, { kind: "edit", messageId: message.id, editedContent: content }, true)}
        managedAppActionEnabled={managedAppAvailable}
        managedAppApprovalKeys={Object.values(managedAppActions)
          .filter((descriptor) => descriptor.locator.threadId === activeThreadId)
          .map((descriptor) => managedAppActionKey(descriptor.locator))}
        onManagedAppPrepared={prepareManagedAppAction}
        onPreviewDocument={(artifact) => {
          setActiveSideWindow(null);
          setPreviewDocument(artifact);
        }}
      />}

      {previewDocument ? (
        <DocumentPreviewPanel key={previewDocument.id} artifact={previewDocument} onClose={() => setPreviewDocument(null)} />
      ) : null}

      {inspectorEnabled && preferences.showInspector && activeSideWindow === "inspector" ? (
        <DetailsPanel
          message={selectedMessage}
          performance={selectedMessage ? clientTurnReadbacks[selectedMessage.id] ?? null : null}
          open
          onClose={() => setActiveSideWindow(null)}
          onResolveApproval={(approvalId, decision) => {
            if (selectedMessage) void resolveApproval(selectedMessage.id, approvalId, decision);
          }}
        />
      ) : null}

      {browserEnabled && activeSideWindow === "browser" ? (
        <BrowserPanel
          threadId={activeThreadId}
          open
          initialStatus={browserMonitorStatus}
          onClose={() => setActiveSideWindow(null)}
        />
      ) : null}

      <CustomizationPanel
        productName={branding.productName}
        open={customizationOpen}
        runtimeStatus={effectiveRuntimeStatus}
        onSettingsSnapshot={setSettingsSnapshot}
        onClose={() => setCustomizationOpen(false)}
      />

      <MemoryPanel
        open={memoryOpen}
        projectId={activeProject?.id ?? null}
        onClose={() => setMemoryOpen(false)}
      />

      <ProjectPanel
        key={`${activeProject?.id ?? "none"}:${activeProject?.updatedAt ?? "none"}`}
        project={activeProject && activeProject.slug !== STANDALONE_PROJECT_SLUG ? activeProject : null}
        open={projectOpen}
        onClose={() => setProjectOpen(false)}
        onSave={async (patch) => Boolean(activeProject && await persistProjectPatch(activeProject, patch))}
      />

      <LibraryPanel
        open={libraryOpen}
        projects={projects}
        threads={threads}
        onClose={() => setLibraryOpen(false)}
        onOpenConversation={(threadId, messageId) => {
          setLibraryOpen(false);
          selectThread(threadId);
          setSelectedMessageId(messageId);
          window.setTimeout(() => document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
        }}
      />

      <TaskCenterPanel
        open={taskCenterOpen}
        tasks={taskCenterItems}
        preferences={taskCenterPayload.preferences}
        notificationPermission={notificationPermission}
        busy={taskCenterBusy}
        onClose={() => setTaskCenterOpen(false)}
        onOpenConversation={(task) => void openTaskConversation(task)}
        onMarkRead={markTaskRead}
        onMarkAllRead={markAllTasksRead}
        onPreferencesChange={(next) => void updateTaskCenter({ action: "preferences", preferences: next })}
        onRequestDesktopNotifications={() => void requestDesktopNotifications()}
      />

      <CommandPalette
        open={commandPaletteOpen}
        projects={projects}
        threads={threads}
        activeProjectId={activeProjectId}
        onClose={() => setCommandPaletteOpen(false)}
        onSelectProject={selectProject}
        onSelectThread={selectThread}
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
