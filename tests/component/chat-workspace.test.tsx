// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("thinking-orbs", () => ({ ThinkingOrb: () => null }));
import { ChatWorkspace } from "@/components/chat-workspace";
import { baseBrainManifest, type BrainPreferences } from "@/config/brain";
import type { ChatMessage } from "@/lib/chat-contract";
import { initialRuntimeStatus } from "@/lib/runtime-status";
import type { WorkbenchProject, WorkbenchThread } from "@/workbench/types";

const project: WorkbenchProject = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Operaciones Arnall",
  slug: "operaciones-arnall",
  status: "active",
  pinned: false,
  instructions: "",
  sources: [],
  memory: { enabled: true, notes: "", updatedAt: null },
  sharing: { visibility: "private", members: [] },
  workspace: { id: "workspace-1", label: "Principal", hostType: "managed", status: "ready", isPrimary: true },
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

const preferences: BrainPreferences = {
  assistantName: "Arnall AI",
  tone: "balanced",
  accent: "blue",
  density: "comfortable",
  corners: "soft",
  showInspector: true,
  showActivityPanel: true,
  conversationMemory: true,
};

function assistantMessage(): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "La información está lista.",
    createdAt: "2026-08-28T00:00:00.000Z",
    status: "complete",
    plan: [],
    activity: [],
    approvals: [{
      id: "approval-1",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      kind: "command",
      title: "Confirmar cambio sensible",
      detail: "La acción requiere permiso.",
      command: "apply-safe-change",
      cwd: "/workspace",
      status: "pending",
    }],
    diff: "",
    attachments: [],
    artifacts: [],
  };
}

function renderWorkspace(
  thread: WorkbenchThread | null = null,
  activeProject: WorkbenchProject | null = project,
  overrides: Partial<ComponentProps<typeof ChatWorkspace>> = {},
) {
  const {
    prompt: initialPrompt = "",
    hydrated: initialHydrated = true,
    onPromptChange = vi.fn(),
    onOpenBrowser = vi.fn(),
    ...remainingOverrides
  } = overrides;
  let finishHydration: () => void = () => undefined;
  function ControlledWorkspace() {
    const [prompt, setPrompt] = useState(initialPrompt);
    const [hydrated, setHydrated] = useState(initialHydrated);
    finishHydration = () => setHydrated(true);
    return <ChatWorkspace
    manifest={baseBrainManifest}
    preferences={preferences}
    project={activeProject}
    thread={thread}
    projects={[project]}
    userName="Ada"
    companyName="Arnall"
    assistantName="Arnall AI"
    hydrated={hydrated}
    prompt={prompt}
    composerExperience="smart"
    imageGeneration={false}
    connectorMentions={[]}
    selectedConnectorMentionIds={[]}
    attachments={[]}
    documents={[]}
    publications={[]}
    documentUploading={false}
    sending={false}
    stopping={false}
    queuedMessages={[]}
    runtimeStatus={{ ...initialRuntimeStatus, mode: "demo", codex: "disabled", ready: true }}
    networkOnline
    streamRecovery={null}
    onRetryRuntime={vi.fn()}
    onPromptChange={(value) => {
      setPrompt(value);
      onPromptChange(value);
    }}
    onComposerExperienceChange={vi.fn()}
    onImageGenerationChange={vi.fn()}
    onDestinationChange={vi.fn()}
    onConnectorMentionIdsChange={vi.fn()}
    onAttachmentsChange={vi.fn()}
    onDocumentsChange={vi.fn()}
    onAddDocuments={vi.fn(async () => undefined)}
    onFreezePublication={vi.fn(async () => undefined)}
    onDecidePublication={vi.fn(async () => undefined)}
    onComposerNotice={vi.fn()}
    onSend={vi.fn()}
    onStop={vi.fn()}
    onCancelQueuedMessage={vi.fn()}
    sidebarOpen
    onToggleSidebar={vi.fn()}
    onResolveApproval={vi.fn(async () => undefined)}
    onEditMessage={vi.fn()}
    managedAppActionEnabled={false}
    managedAppApprovalKeys={[]}
    onManagedAppPrepared={vi.fn()}
    onPreviewDocument={vi.fn()}
    onOpenReview={vi.fn()}
    onOpenBrowser={onOpenBrowser}
    {...remainingOverrides}
  />;
  }
  return { ...render(<ControlledWorkspace />), finishHydration };
}

afterEach(cleanup);

afterAll(() => vi.unstubAllGlobals());

beforeAll(() => {
  // jsdom has no layout observer. Actual scroll following is verified in
  // conversation.spec.ts with Chromium; keep the hook active in these tests.
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), configurable: true });
});

describe("chat workspace simplificado", () => {
  it("stages dropped and pasted files in the current draft without sending or publishing", async () => {
    const onAddDocuments = vi.fn(async () => undefined);
    const onSend = vi.fn();
    const onRequestPublication = vi.fn();
    renderWorkspace(null, project, { prompt: "Keep this draft", onAddDocuments, onSend, onRequestPublication,
      runtimeStatus: { ...initialRuntimeStatus, mode: "codex", codex: "connected", ready: true } });
    const png = new File(["synthetic image bytes"], "image.png", { type: "image/png" });
    const pdf = new File(["synthetic pdf bytes"], "notes.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByRole("main"), { dataTransfer: { types: ["Files"], files: [png, pdf] } });
    await waitFor(() => expect(onAddDocuments).toHaveBeenCalledWith([png, pdf]));
    expect(screen.getByRole("textbox", { name: "Mensaje" })).toHaveValue("Keep this draft");
    expect(onSend).not.toHaveBeenCalled();
    expect(onRequestPublication).not.toHaveBeenCalled();
    expect(screen.queryByText("Destino oficial")).toBeNull();
    await waitFor(() => expect(screen.queryByText("Preparando adjuntos…")).toBeNull());
    fireEvent.paste(screen.getByRole("textbox", { name: "Mensaje" }), { clipboardData: { files: [png] } });
    await waitFor(() => expect(onAddDocuments).toHaveBeenCalledTimes(2));
    expect(onAddDocuments).toHaveBeenLastCalledWith([png]);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Mensaje" })).toHaveValue("Keep this draft");
  });

  it("offers publication only after a deliberate action on a sent attachment", () => {
    const onRequestPublication = vi.fn();
    const attachment = { id: "00000000-0000-4000-8000-000000000019", name: "notes.pdf", mimeType: "application/pdf", size: 128 };
    renderWorkspace({ id: "thread-1", projectId: project.id, title: "Private files", status: "active", pinned: false,
      createdAt: project.createdAt, updatedAt: project.updatedAt,
      messages: [{ ...assistantMessage(), id: "user-1", role: "user", content: "Read this", attachments: [attachment], approvals: [] }, assistantMessage()],
    }, project, { onRequestPublication });
    expect(onRequestPublication).not.toHaveBeenCalled();
    expect(screen.queryByText("Destino oficial")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preparar publicación de notes.pdf" }));
    expect(onRequestPublication).toHaveBeenCalledExactlyOnceWith(attachment, "message-1");
  });

  it("rejects dropped directories and ignores normal text drags", () => {
    const onAddDocuments = vi.fn(async () => undefined);
    const onComposerNotice = vi.fn();
    renderWorkspace(null, project, { onAddDocuments, onComposerNotice,
      runtimeStatus: { ...initialRuntimeStatus, mode: "codex", codex: "connected", ready: true } });
    fireEvent.dragEnter(screen.getByRole("main"), { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(screen.queryByText("Suelta los archivos para adjuntarlos")).toBeNull();
    fireEvent.drop(screen.getByRole("main"), { dataTransfer: { types: ["Files"], files: [], items: [
      { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => null },
    ] } });
    expect(onComposerNotice).toHaveBeenCalledWith(expect.stringContaining("carpetas"));
    expect(onAddDocuments).not.toHaveBeenCalled();
  });

  it("renders the final answer as rich Markdown once and outside collapsed work activity", () => {
    const message: ChatMessage = {
      ...assistantMessage(),
      content: "## Informe final\n\n- Evidencia verificada\n- Próximo paso",
      durationMs: 3_000,
      approvals: [],
      activity: [{
        id: "commentary-1",
        kind: "reasoning",
        label: "Actualización de trabajo",
        detail: "He comprobado la fuente autorizada.",
        status: "complete",
      }],
    };
    renderWorkspace({
      id: "thread-1",
      projectId: project.id,
      title: "Informe",
      status: "active",
      pinned: false,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:03.000Z",
      messages: [message],
    });

    const activityTrigger = screen.getByRole("button", { name: "Mostrar el proceso de trabajo" });
    expect(activityTrigger).toHaveAttribute("aria-expanded", "false");
    expect(activityTrigger).toHaveTextContent("Ha trabajado durante 0m 3s");
    expect(screen.getAllByRole("heading", { name: "Informe final" })).toHaveLength(1);
    expect(screen.getByText("Evidencia verificada").closest("li")).toBeInTheDocument();
    expect(screen.getByText("He comprobado la fuente autorizada.")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Informe final" }).closest(".markdown-body")?.parentElement).toHaveClass("text-[14px]");
    expect(screen.getByTestId("composer")).toHaveAttribute("data-layout", "conversation");
    expect(screen.getByTestId("composer")).toHaveClass("composer-compact");
    expect(screen.getByTestId("composer")).toHaveAttribute("data-focused", "false");
    fireEvent.focus(screen.getByRole("textbox", { name: "Mensaje" }));
    expect(screen.getByTestId("composer")).toHaveAttribute("data-focused", "true");
    expect(screen.getByTestId("composer")).toHaveClass("composer-focused");
    fireEvent.blur(screen.getByRole("textbox", { name: "Mensaje" }), { relatedTarget: null });
    expect(screen.getByTestId("composer")).toHaveAttribute("data-focused", "false");
  });

  it("opens the review surface for the exact completed message", () => {
    const onOpenReview = vi.fn();
    const message = { ...assistantMessage(), diff: "diff --git a/a.txt b/a.txt\n+a" };
    renderWorkspace({
      id: "thread-review",
      projectId: project.id,
      title: "Revisión",
      status: "active",
      pinned: false,
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      messages: [message],
    }, project, { onOpenReview });

    fireEvent.click(screen.getByRole("button", { name: "Abrir cambios y resultados" }));
    expect(onOpenReview).toHaveBeenCalledWith(message.id);
  });

  it("adopts a draft typed before hydration instead of resetting it", () => {
    const onPromptChange = vi.fn();
    const { finishHydration } = renderWorkspace(null, project, {
      hydrated: false,
      onPromptChange,
    });
    const composer = screen.getByRole("textbox", { name: "Mensaje" }) as HTMLTextAreaElement;

    composer.value = "Borrador escrito durante la carga";
    act(() => finishHydration());

    expect(composer).toHaveValue("Borrador escrito durante la carga");
    expect(onPromptChange).toHaveBeenLastCalledWith("Borrador escrito durante la carga");
  });

  it("shows only the authorized connector autocomplete and binds a selected @ source", () => {
    const onPromptChange = vi.fn();
    const onConnectorMentionIdsChange = vi.fn();
    renderWorkspace(null, project, {
      connectorMentions: [
        { id: "gmail", label: "Gmail", kind: "connector", status: "connected", statusCode: null, canRead: true, requiresApprovalForWrites: true },
        { id: "outlook", label: "Outlook", kind: "connector", status: "connected", statusCode: null, canRead: true, requiresApprovalForWrites: false },
        { id: "executive-crm", label: "CRM Ejecutivo", kind: "connector", status: "requires_login", statusCode: "CONNECTOR_LOGIN_REQUIRED", canRead: false, requiresApprovalForWrites: false },
      ],
      onPromptChange,
      onConnectorMentionIdsChange,
    });
    const composer = screen.getByLabelText("Mensaje");
    fireEvent.change(composer, { target: { value: "Busca @" } });
    expect(screen.getByRole("listbox", { name: "Conectores disponibles" })).toHaveTextContent("Gmail");
    expect(screen.getByRole("listbox", { name: "Conectores disponibles" })).toHaveTextContent("Outlook");
    expect(screen.queryByText("CRM Ejecutivo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Gmail/ }));
    expect(onConnectorMentionIdsChange).toHaveBeenCalledWith(["gmail"]);
    expect(onPromptChange).toHaveBeenLastCalledWith("Busca @Gmail ");
  });

  it("moves through connector suggestions before selecting the active option", () => {
    const onPromptChange = vi.fn();
    const onConnectorMentionIdsChange = vi.fn();
    renderWorkspace(null, project, {
      connectorMentions: [
        { id: "gmail", label: "Gmail", kind: "connector", status: "connected", statusCode: null, canRead: true, requiresApprovalForWrites: true },
        { id: "outlook", label: "Outlook", kind: "connector", status: "connected", statusCode: null, canRead: true, requiresApprovalForWrites: false },
      ],
      onPromptChange,
      onConnectorMentionIdsChange,
    });
    const composer = screen.getByRole("textbox", { name: "Mensaje" });
    fireEvent.change(composer, { target: { value: "Busca @" } });
    const gmail = screen.getByRole("option", { name: /Gmail/ });
    const outlook = screen.getByRole("option", { name: /Outlook/ });
    expect(gmail).toHaveAttribute("aria-selected", "true");
    expect(composer).toHaveAttribute("aria-activedescendant", gmail.id);

    fireEvent.keyDown(composer, { key: "ArrowDown" });
    expect(outlook).toHaveAttribute("aria-selected", "true");
    expect(composer).toHaveAttribute("aria-activedescendant", outlook.id);
    expect(fireEvent.keyDown(composer, { key: "Home" })).toBe(true);
    expect(outlook).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
    expect(onConnectorMentionIdsChange).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(onConnectorMentionIdsChange).toHaveBeenCalledWith(["outlook"]);
    expect(onPromptChange).toHaveBeenLastCalledWith("Busca @Outlook ");
  });

  it("keeps connector option ids collision-free and leaves caret arrows native without results", () => {
    renderWorkspace(null, project, {
      connectorMentions: [
        { id: "mail.work", label: "Correo punto", kind: "connector", status: "connected", statusCode: null, canRead: true, requiresApprovalForWrites: false },
        { id: "mail:work", label: "Correo dos puntos", kind: "connector", status: "connected", statusCode: null, canRead: true, requiresApprovalForWrites: false },
        { id: "mail-work", label: "Correo guion", kind: "connector", status: "connected", statusCode: null, canRead: true, requiresApprovalForWrites: false },
      ],
    });
    const composer = screen.getByRole("textbox", { name: "Mensaje" });
    fireEvent.change(composer, { target: { value: "Busca @" } });
    const ids = screen.getAllByRole("option").map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);

    fireEvent.change(composer, { target: { value: "Busca @sin-coincidencias" } });
    expect(screen.getByRole("listbox", { name: "Conectores disponibles" })).toHaveTextContent("No hay conectores");
    expect(fireEvent.keyDown(composer, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(composer, { key: "ArrowUp" })).toBe(true);
    fireEvent.blur(composer, { relatedTarget: screen.getByRole("button", { name: "Añadir al mensaje" }) });
    expect(screen.queryByRole("listbox", { name: "Conectores disponibles" })).not.toBeInTheDocument();
  });

  it("keeps the landing focused on its editable destination and honest suggestions", () => {
    renderWorkspace();

    expect(screen.getByTestId("composer")).toHaveAttribute("data-layout", "landing");
    expect(screen.getByTestId("composer")).toHaveClass("composer-landing");
    expect(screen.getByTestId("composer")).not.toHaveClass("composer-compact");
    expect(screen.getByTestId("composer-controls")).toContainElement(screen.getByRole("button", { name: "Añadir al mensaje" }));
    expect(screen.getAllByText("Operaciones Arnall").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "¿Cómo puedo ayudarte en Operaciones Arnall?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Destino de la conversación")).toHaveTextContent("Operaciones Arnall");
    expect(screen.getByRole("textbox", { name: "Mensaje" })).toHaveFocus();
    expect(screen.queryByText("Trabajar")).not.toBeInTheDocument();
    expect(screen.getByText("Prioridades")).toBeInTheDocument();
    expect(screen.getByTestId("project-breadcrumb")).toHaveTextContent("Operaciones Arnall");
    expect(screen.queryByRole("button", { name: /Abrir contexto/ })).not.toBeInTheDocument();
    for (const removed of ["Analizar información", "Crear un documento", "Resumir contenido", "Comprueba los datos importantes antes de usarlos.", "Planificar", "Preguntar", "↵ enviar"]) {
      expect(screen.queryByText(removed, { exact: false })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Abrir preferencias")).not.toBeInTheDocument();
  });

  it("uses only the employee's first name on a standalone landing", () => {
    renderWorkspace(null, null, { userName: "David Liria" });

    expect(screen.getByRole("heading", { name: "¿En qué te puedo ayudar, David?" })).toBeInTheDocument();
    expect(screen.queryByText("David Liria", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps the add menu limited to files and authorized connectors", async () => {
    renderWorkspace(null, project, {
      runtimeStatus: { ...initialRuntimeStatus, mode: "codex", codex: "connected", ready: true },
      connectorMentions: [
        { id: "gmail", label: "Gmail", kind: "connector", status: "connected", statusCode: null, canRead: true, requiresApprovalForWrites: true },
        { id: "outlook", label: "Outlook", kind: "connector", status: "requires_login", statusCode: "OUTLOOK_LOGIN_REQUIRED", canRead: false, requiresApprovalForWrites: false },
      ],
    });

    const add = screen.getByRole("button", { name: "Añadir al mensaje" });
    fireEvent.click(add);
    expect(screen.getByRole("menuitem", { name: "Adjuntar archivos" })).toBeInTheDocument();
    expect(screen.getByLabelText("Seleccionar archivos para adjuntar")).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByRole("menuitem", { name: "Añadir carpeta" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Seleccionar archivos para adjuntar")).not.toHaveAttribute("webkitdirectory");
    expect(screen.getByLabelText("Seleccionar archivos para adjuntar")).not.toHaveAttribute("directory");
    expect(screen.getByRole("menuitem", { name: "Conectores" })).toBeInTheDocument();
    for (const removed of ["Acciones guiadas", "Buscar en la web", "Crear imagen", "Desactivar búsqueda web"]) {
      expect(screen.queryByText(removed, { exact: false })).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("menuitem", { name: "Conectores" }));
    const catalog = screen.getByRole("listbox", { name: "Catálogo de conectores" });
    expect(catalog).toHaveTextContent("Gmail");
    expect(catalog).toHaveTextContent("Outlook");
    expect(screen.getByRole("option", { name: /Outlook/ })).toBeDisabled();
    await waitFor(() => expect(catalog).toHaveFocus());
    fireEvent.keyDown(catalog, { key: "Tab" });
    await waitFor(() => expect(add).toHaveFocus());
    expect(screen.queryByRole("listbox", { name: "Catálogo de conectores" })).not.toBeInTheDocument();
    fireEvent.click(add);
    expect(screen.getByRole("menu", { name: "Añadir al mensaje" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Catálogo de conectores" })).not.toBeInTheDocument();
  });

  it("returns focus to Add when the connector catalog is empty", async () => {
    const onComposerNotice = vi.fn();
    renderWorkspace(null, project, { connectorMentions: [], onComposerNotice });
    const add = screen.getByRole("button", { name: "Añadir al mensaje" });
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("menuitem", { name: "Conectores" }));
    expect(onComposerNotice).toHaveBeenCalledWith("No hay conectores habilitados en tu catálogo.");
    await waitFor(() => expect(add).toHaveFocus());
  });

  it("submits with Enter while preserving composition and multiline input", () => {
    const onSend = vi.fn();
    renderWorkspace(null, project, { prompt: "Prepara el resum", onSend });
    const prompt = screen.getByRole("textbox", { name: "Mensaje" });

    fireEvent.keyDown(prompt, { key: "Enter", isComposing: true });
    fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("enables governed image generation from the composer and exposes its active state", () => {
    const onImageGenerationChange = vi.fn();
    renderWorkspace(null, project, {
      runtimeStatus: {
        ...initialRuntimeStatus,
        mode: "codex",
        codex: "connected",
        ready: true,
        capabilities: { ...initialRuntimeStatus.capabilities, imageGeneration: true },
      },
      onImageGenerationChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Añadir al mensaje" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Crear imagen" }));
    expect(onImageGenerationChange).toHaveBeenCalledWith(true);
  });

  it("offers image examples as editable drafts without sending or discarding existing text", () => {
    const onSend = vi.fn();
    renderWorkspace(null, project, { imageGeneration: true, prompt: "Usa mis colores.", onSend });
    expect(screen.getByRole("heading", { name: "¿Qué imagen quieres crear?" })).toBeInTheDocument();
    const composer = screen.getByRole("textbox", { name: "Mensaje" });
    expect(composer).toHaveAttribute("placeholder", "Describe la imagen que quieres crear…");
    expect(screen.queryByText("Prioridades")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Para una presentación/ }));
    expect(composer).toHaveValue("Usa mis colores.\n\nCrea una imagen horizontal para una presentación sobre…");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("fills a normal suggestion for review rather than submitting it", () => {
    const onSend = vi.fn();
    renderWorkspace(null, project, { onSend });
    fireEvent.click(screen.getByRole("button", { name: /^Prioridades/ }));
    expect(screen.getByRole("textbox", { name: "Mensaje" })).toHaveValue(`Organiza las prioridades de esta semana para ${project.name}.`);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("queues the next message while keeping stop and cancellation available", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const onCancelQueuedMessage = vi.fn();
    const thread: WorkbenchThread = {
      id: "thread-queue",
      projectId: project.id,
      title: "Cola",
      status: "active",
      pinned: false,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:01.000Z",
      messages: [
        { ...assistantMessage(), id: "user-running", role: "user", content: "Analiza el documento", approvals: [] },
        { ...assistantMessage(), id: "assistant-running", status: "streaming", content: "Trabajando", approvals: [] },
      ],
    };
    renderWorkspace(thread, project, {
      prompt: "Prepara el resumen",
      sending: true,
      queuedMessages: [{ id: "queued-1", text: "Compara las conclusiones" }],
      onSend,
      onStop,
      onCancelQueuedMessage,
    });

    expect(screen.getAllByText("Analiza el documento")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Añadir mensaje a la cola" }));
    expect(onSend).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Detener respuesta" }));
    expect(onStop).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: 'Quitar "Compara las conclusiones" de la cola' }));
    expect(onCancelQueuedMessage).toHaveBeenCalledWith("queued-1");
  });

  it("offers only the three named work experiences with complete menu navigation", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Experiencia" }));
    expect(screen.getByRole("menuitemradio", { name: /Rápido/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Inteligente/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Experto/ })).toBeInTheDocument();
    const menu = screen.getByRole("menu", { name: "Experiencia" });
    expect(menu).not.toHaveTextContent(/GPT|Terra|Sol/i);
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: /Inteligente/ })).toHaveFocus());
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitemradio", { name: /Experto/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitemradio", { name: /Rápido/ })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Aprobar permisos automáticamente" })).not.toBeInTheDocument();
  });

  it("keeps one action control and exposes stop while the agent is working", () => {
    const onStop = vi.fn();
    renderWorkspace(null, project, { prompt: "Continua", sending: true, onStop });

    expect(screen.queryByRole("button", { name: "Enviar mensaje" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Detener respuesta" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("keeps a live response pinned without restarting smooth scrolling for every delta", () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    const message = assistantMessage();
    const thread: WorkbenchThread = {
      id: "thread-streaming",
      projectId: project.id,
      title: "Respuesta en curso",
      status: "active",
      pinned: false,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:01.000Z",
      messages: [{ ...message, status: "streaming", content: "Texto parcial" }],
    };

    renderWorkspace(thread, project, { sending: true });

    expect(screen.getByText("Texto parcial").closest("[data-state='streaming']")).toHaveAttribute("aria-busy", "true");
    expect(scrollIntoView).not.toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });

  it("shows the latest honest lifecycle status instead of a generic thinking placeholder", () => {
    const message = assistantMessage();
    const thread: WorkbenchThread = {
      id: "thread-feedback",
      projectId: project.id,
      title: "Respuesta en curso",
      status: "active",
      pinned: false,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:01.000Z",
      messages: [{
        ...message,
        content: "",
        status: "streaming",
        approvals: [],
        activity: [{ id: "runtime-context", kind: "system", label: "Preparant el context", status: "running" }],
      }],
    };

    renderWorkspace(thread, project, { sending: true });

    expect(screen.getByRole("status")).toHaveTextContent("Preparando el contexto");
    expect(screen.queryByText("Pensando…")).not.toBeInTheDocument();
  });

  it("prevents duplicate stop requests while App Server confirms cancellation", () => {
    const onStop = vi.fn();
    renderWorkspace(null, project, { sending: true, stopping: true, onStop });

    const button = screen.getByRole("button", { name: "Deteniendo respuesta" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("shows a file drop message and forwards dropped files to the existing attachment flow", () => {
    const onAddDocuments = vi.fn(async () => undefined);
    renderWorkspace(null, project, {
      runtimeStatus: { ...initialRuntimeStatus, mode: "codex", codex: "connected", ready: true },
      onAddDocuments,
    });

    const composer = screen.getByTestId("composer");
    const file = new File(["contenido"], "informe.pdf", { type: "application/pdf" });
    fireEvent.dragEnter(composer, { dataTransfer: { files: [file] } });
    expect(screen.getByText("Suelta los archivos para adjuntarlos")).toBeInTheDocument();
    fireEvent.drop(composer, { dataTransfer: { files: [file] } });

    expect(onAddDocuments).toHaveBeenCalledWith([file]);
  });

  it("keeps only copy below a response while retaining sensitive approval cards", () => {
    const thread: WorkbenchThread = {
      id: "thread-1",
      projectId: project.id,
      title: "Consulta",
      status: "active",
      pinned: false,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
      messages: [assistantMessage()],
    };
    renderWorkspace(thread);

    expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Aprobación: Confirmar cambio sensible" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Permitir" })).toBeInTheDocument();
    for (const removed of ["Aprobar resultado", "Descargar resultado", "Leer en voz alta", "Regenerar respuesta", "Crear rama desde aquí", "Revisar resultados"]) {
      expect(screen.queryByLabelText(removed)).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Acciones de conversación")).not.toBeInTheDocument();
  });
});
