// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailsPanel } from "@/components/details-panel";
import { TurnActivity } from "@/components/turn-activity";
import type { ChatMessage } from "@/lib/chat-contract";

const message: ChatMessage = {
  id: "message-1",
  role: "assistant",
  content: "## Resultado",
  createdAt: "2026-08-27T00:00:00.000Z",
  status: "complete",
  plan: [
    { step: "Revisar el proyecto", status: "completed" },
    { step: "Aplicar el cambio", status: "in_progress" },
  ],
  activity: [{
    id: "command-1",
    kind: "command",
    label: "Comprobar estado",
    detail: "Comprobación sintética terminada",
    output: "ok",
    status: "complete",
  }],
  approvals: [{
    id: "approval-1",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    kind: "command",
    title: "Ejecutar comprobación",
    detail: "Solo lee el estado sintético.",
    command: "check --synthetic",
    cwd: "/workspace/synthetic",
    status: "pending",
  }],
  diff: [
    "diff --git a/resultado.txt b/resultado.txt",
    "--- a/resultado.txt",
    "+++ b/resultado.txt",
    "@@ -1 +1 @@",
    "-Pendiente",
    "+Completado",
  ].join("\n"),
  attachments: [],
  artifacts: [],
};

afterEach(cleanup);

describe("turn activity and Review", () => {
  it("keeps live activity compact, updates its shimmer label and opens details on demand", () => {
    const liveMessage: ChatMessage = {
      ...message,
      status: "streaming",
      plan: [],
      approvals: [],
      diff: "",
      activity: [
        { ...message.activity[0], id: "reasoning-1", kind: "reasoning", status: "complete" },
        { ...message.activity[0], id: "file-1", kind: "file", status: "running" },
      ],
    };
    const { container, rerender } = render(<TurnActivity
      message={liveMessage}
      onResolveApproval={vi.fn()}
    />);
    const details = container.querySelector("details");
    const summary = container.querySelector("summary");
    if (!details || !summary) throw new Error("Live activity details were not rendered");

    expect(details).not.toHaveAttribute("open");
    expect(within(summary).getByText("Editando archivos")).toHaveClass("activity-shimmer");
    expect(screen.getByText("Respuesta preparada")).not.toBeVisible();

    rerender(<TurnActivity
      message={{
        ...liveMessage,
        activity: [
          { ...liveMessage.activity[0] },
          { ...liveMessage.activity[1], status: "complete" },
          { ...message.activity[0], id: "command-1", kind: "command", status: "running" },
        ],
      }}
      onResolveApproval={vi.fn()}
    />);

    expect(details).not.toHaveAttribute("open");
    expect(within(summary).getByText("Ejecutando comando")).toHaveClass("activity-shimmer");
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Respuesta preparada")).toBeVisible();
  });

  it("presents plan, command output, diff and approval decisions in employee language", () => {
    const onResolve = vi.fn();
    render(<TurnActivity message={message} onResolveApproval={onResolve} />);

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Comando completado")).toBeInTheDocument();
    expect(screen.getByText("Comprobación sintética terminada")).toBeInTheDocument();
    expect(screen.getByText("Cambios preparados")).toBeInTheDocument();
    const approval = screen.getByRole("group", { name: "Aprobación: Ejecutar comprobación" });
    fireEvent.click(within(approval).getByRole("button", { name: "Permitir" }));
    expect(onResolve).toHaveBeenCalledWith(message.approvals[0], "accept");
  });

  it("keeps connector outcomes auditable and removes session-wide approval", () => {
    const connectorApproval = { ...message.approvals[0], id: "connector-approval", title: "Confirmar acción conectada" };
    render(<TurnActivity
      message={{
        ...message,
        approvals: [connectorApproval],
        toolResults: [{
          id: "managed-app:connector-approval", kind: "app", title: "Acción conectada", status: "failed",
          summary: "indeterminate", output: null, sourceIds: [], createdAt: "2026-08-28T12:00:00.000Z",
        }],
      }}
      onResolveApproval={vi.fn()}
      managedAppApprovalKeys={[JSON.stringify(["thread-1", "turn-1", "item-1", "connector-approval"])]}
    />);

    expect(screen.queryByRole("button", { name: "Durante esta tarea" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Acción conectada"));
    expect(screen.getByText("indeterminate")).toBeVisible();
  });

  it("renders an inspectable file diff and activity tabs", () => {
    render(<DetailsPanel message={message} open onClose={vi.fn()} onResolveApproval={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Review del turno" })).toBeInTheDocument();
    expect(screen.getAllByText("resultado.txt")).toHaveLength(2);
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("−1").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Actividad/ }));
    expect(screen.getByText("Comando completado")).toBeInTheDocument();
  });
});
