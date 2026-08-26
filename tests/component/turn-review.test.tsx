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
  it("presents plan, command output, diff and approval decisions in employee language", () => {
    const onResolve = vi.fn();
    render(<TurnActivity message={message} onResolveApproval={onResolve} />);

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Comando completado")).toBeInTheDocument();
    expect(screen.getByText("Comprobación sintética terminada")).toBeInTheDocument();
    expect(screen.getByText("Cambios preparados")).toBeInTheDocument();
    const approval = screen.getByRole("group", { name: "Aprobación: Ejecutar comprobación" });
    fireEvent.click(within(approval).getByRole("button", { name: "Permitir una vez" }));
    expect(onResolve).toHaveBeenCalledWith("approval-1", "accept");
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
