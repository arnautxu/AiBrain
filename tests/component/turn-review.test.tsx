// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("shows safe live activity labels with shimmer while a turn is running", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<TurnActivity
        message={{
          ...message,
          status: "streaming",
          plan: [],
          approvals: [],
          diff: "",
          activity: [
            { ...message.activity[0], id: "reasoning-1", kind: "reasoning", detail: "Analizando el contexto", status: "running" },
            { ...message.activity[0], id: "file-1", kind: "file", status: "running" },
            { ...message.activity[0], id: "command-1", kind: "command", status: "running" },
          ],
        }}
        onResolveApproval={vi.fn()}
      />);

      expect(screen.getByText("Trabajando")).toHaveClass("activity-shimmer");
      expect(screen.getByText("Pensando")).toHaveClass("activity-shimmer");
      expect(screen.getByText("Editando archivos")).toHaveClass("activity-shimmer");
      expect(screen.getByText("Ejecutando comando")).toHaveClass("activity-shimmer");
      expect(container.querySelectorAll(".agent-status-orb")).toHaveLength(4);
      expect(container.querySelectorAll(".reasoning-stream .t-stream-w")).toHaveLength(3);
      expect(container.querySelectorAll(".reasoning-stream .t-stream-w.is-in")).toHaveLength(0);
      act(() => vi.advanceTimersByTime(60));
      expect(container.querySelectorAll(".reasoning-stream .t-stream-w.is-in")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
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
