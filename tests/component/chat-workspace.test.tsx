// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
  return render(<ChatWorkspace
    manifest={baseBrainManifest}
    preferences={preferences}
    project={activeProject}
    thread={thread}
    hydrated
    prompt=""
    composerModel={null}
    composerEffort={null}
    webSearch
    imageGeneration={false}
    selectedSkill={null}
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
    onPromptChange={vi.fn()}
    onComposerModelChange={vi.fn()}
    onComposerEffortChange={vi.fn()}
    onWebSearchChange={vi.fn()}
    onImageGenerationChange={vi.fn()}
    onSelectedSkillChange={vi.fn()}
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
    onOpenProject={vi.fn()}
    onResolveApproval={vi.fn(async () => undefined)}
    onEditMessage={vi.fn()}
    managedAppActionEnabled={false}
    managedAppApprovalKeys={[]}
    onManagedAppPrepared={vi.fn()}
    showAdvancedControls={false}
    {...overrides}
  />);
}

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), configurable: true });
});

describe("chat workspace simplificado", () => {
  it("keeps the landing focused on its exact project destination without suggestions or disclaimer", () => {
    renderWorkspace();

    expect(screen.getAllByText("Operaciones Arnall").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "¿En qué trabajamos?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Destino de la conversación")).toHaveTextContent("Operaciones Arnall");
    expect(screen.getByText("Trabajar")).toBeInTheDocument();
    expect(screen.getByTestId("project-breadcrumb")).toHaveTextContent("Operaciones Arnall");
    expect(screen.queryByRole("button", { name: /Abrir contexto/ })).not.toBeInTheDocument();
    for (const removed of ["Analizar información", "Crear un documento", "Resumir contenido", "Comprueba los datos importantes antes de usarlos.", "Planificar", "Preguntar", "↵ enviar"]) {
      expect(screen.queryByText(removed, { exact: false })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Abrir preferencias")).not.toBeInTheDocument();
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

  it("keeps one action control and exposes stop while the agent is working", () => {
    const onStop = vi.fn();
    renderWorkspace(null, project, { prompt: "Continua", sending: true, onStop });

    expect(screen.queryByRole("button", { name: "Enviar mensaje" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Detener respuesta" }));
    expect(onStop).toHaveBeenCalledOnce();
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
