// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
  const { prompt: initialPrompt = "", onPromptChange = vi.fn(), ...remainingOverrides } = overrides;
  function ControlledWorkspace() {
    const [prompt, setPrompt] = useState(initialPrompt);
    return <ChatWorkspace
    manifest={baseBrainManifest}
    preferences={preferences}
    project={activeProject}
    thread={thread}
    projects={[project]}
    userName="Ada"
    companyName="Arnall"
    assistantName="Arnall AI"
    hydrated
    prompt={prompt}
    composerExperience="smart"
    webSearch
    imageGeneration={false}
    connectorMentions={[]}
    selectedConnectorMentionIds={[]}
    attachments={[]}
    documents={[]}
    publications={[]}
    documentUploading={false}
    sending={false}
    stopping={false}
    runtimeStatus={{ ...initialRuntimeStatus, mode: "demo", codex: "disabled", ready: true }}
    appPolicy={{ webSearch: true, imageGeneration: true, skills: true }}
    networkOnline
    streamRecovery={null}
    onRetryRuntime={vi.fn()}
    onPromptChange={(value) => {
      setPrompt(value);
      onPromptChange(value);
    }}
    onComposerExperienceChange={vi.fn()}
    onDestinationChange={vi.fn()}
    onWebSearchChange={vi.fn()}
    onImageGenerationChange={vi.fn()}
    onConnectorMentionIdsChange={vi.fn()}
    onAttachmentsChange={vi.fn()}
    onDocumentsChange={vi.fn()}
    onAddDocuments={vi.fn(async () => undefined)}
    onFreezePublication={vi.fn(async () => undefined)}
    onDecidePublication={vi.fn(async () => undefined)}
    onComposerNotice={vi.fn()}
    onSend={vi.fn()}
    onStop={vi.fn()}
    sidebarOpen
    onToggleSidebar={vi.fn()}
    onResolveApproval={vi.fn(async () => undefined)}
    onEditMessage={vi.fn()}
    managedAppActionEnabled={false}
    managedAppApprovalKeys={[]}
    onManagedAppPrepared={vi.fn()}
    onPreviewDocument={vi.fn()}
    {...remainingOverrides}
  />;
  }
  return render(<ControlledWorkspace />);
}

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), configurable: true });
});

describe("chat workspace simplificado", () => {
  it("shows only the authorized connector autocomplete and binds a selected @ source", () => {
    const onPromptChange = vi.fn();
    const onConnectorMentionIdsChange = vi.fn();
    renderWorkspace(null, project, {
      connectorMentions: [
        { id: "gmail", label: "Gmail", kind: "connector", status: "connected", statusCode: null, canRead: true, requiresApprovalForWrites: true },
        { id: "executive-crm", label: "CRM Ejecutivo", kind: "connector", status: "requires_login", statusCode: "CONNECTOR_LOGIN_REQUIRED", canRead: false, requiresApprovalForWrites: false },
      ],
      onPromptChange,
      onConnectorMentionIdsChange,
    });
    const composer = screen.getByLabelText("Mensaje");
    fireEvent.change(composer, { target: { value: "Busca @gm" } });
    expect(screen.getByRole("listbox", { name: "Conectores disponibles" })).toHaveTextContent("Gmail");
    expect(screen.queryByText("CRM Ejecutivo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Gmail/ }));
    expect(onConnectorMentionIdsChange).toHaveBeenCalledWith(["gmail"]);
    expect(onPromptChange).toHaveBeenLastCalledWith("Busca @Gmail ");
  });

  it("keeps the landing focused on its editable destination and honest suggestions", () => {
    renderWorkspace();

    expect(screen.getAllByText("Operaciones Arnall").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "¿Cómo puedo ayudarte en Operaciones Arnall?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Destino de la conversación")).toHaveTextContent("Operaciones Arnall");
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

  it("replaces the composer with a focused guided flow and reveals secondary actions on request", () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Añadir al mensaje" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Acciones guiadas" }));

    expect(screen.getByRole("heading", { name: "¿Qué quieres conseguir?" })).toBeInTheDocument();
    expect(screen.queryByTestId("composer")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Cómo funciona" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Informe de seguimiento/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analiza" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver todas las acciones" }));
    expect(screen.getByRole("button", { name: /^Analiza/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Prefiero escribir directamente" }));
    expect(screen.getByTestId("composer")).toBeInTheDocument();
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

  it("offers only the three named work experiences and no permission control", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Experiencia" }));
    expect(screen.getByRole("menuitemradio", { name: /Rápido/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Smart/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Experto/ })).toBeInTheDocument();
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

    expect(scrollIntoView).not.toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
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
