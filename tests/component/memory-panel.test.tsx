// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GovernedMemoryRecord } from "@/memory/proposal-store";
import { MemoryPanel } from "@/components/memory-panel";
import {
  listExplicitMemories,
  listMemoryGovernance,
} from "@/ui/memory-ui-adapter";

vi.mock("@/ui/memory-ui-adapter", () => ({
  confirmMemoryProposal: vi.fn(),
  createExplicitMemory: vi.fn(),
  deleteGovernedMemory: vi.fn(),
  listExplicitMemories: vi.fn(),
  listMemoryGovernance: vi.fn(),
  rejectMemoryProposal: vi.fn(),
  revokeExplicitMemory: vi.fn(),
  updateGovernedMemory: vi.fn(),
}));

const projectId = "10000000-0000-4000-8000-000000000001";
const secondProjectId = "10000000-0000-4000-8000-000000000002";
const governanceEmpty = { proposals: [], memories: [], allowCompanyScope: false };
const governedMemory: GovernedMemoryRecord = {
  schemaVersion: 1,
  memoryId: "20000000-0000-4000-8000-000000000001",
  proposalId: "30000000-0000-4000-8000-000000000001",
  installationId: "memory-qa",
  ownerUserId: "40000000-0000-4000-8000-000000000001",
  projectId,
  scope: "project",
  kind: "decision",
  content: "Usar el cierre confirmado por Operaciones.",
  provenance: {
    sourceType: "tool-assisted-chat",
    threadId: "thread-1",
    turnId: "turn-1",
    callId: "call-1",
    toolNames: [],
    sourceExcerpt: "Cierre confirmado.",
    capturedAt: "2026-08-30T08:00:00.000Z",
  },
  status: "active",
  revision: 1,
  createdAt: "2026-08-30T08:00:00.000Z",
  updatedAt: "2026-08-30T08:00:00.000Z",
  deletedAt: null,
  deletedBy: null,
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("MemoryPanel states and governed editor", () => {
  it("keeps loading and load failures distinct from a verified empty memory list", async () => {
    vi.mocked(listExplicitMemories).mockRejectedValueOnce(new Error("Memoria temporalmente no disponible.")).mockResolvedValueOnce([]);
    vi.mocked(listMemoryGovernance).mockResolvedValue(governanceEmpty);

    render(<MemoryPanel open projectId={projectId} onClose={vi.fn()} />);
    expect(screen.getByText("Cargando memoria…")).toBeInTheDocument();
    expect(screen.queryByText("Aún no hay memorias guardadas")).not.toBeInTheDocument();

    const retry = await screen.findByRole("button", { name: "Reintentar" });
    expect(screen.queryByText("Aún no hay memorias guardadas")).not.toBeInTheDocument();
    fireEvent.click(retry);

    expect(await screen.findByText("Aún no hay memorias guardadas")).toBeInTheDocument();
    expect(listExplicitMemories).toHaveBeenCalledTimes(2);
  });

  it("gives the governed memory editor a persistent accessible label", async () => {
    vi.mocked(listExplicitMemories).mockResolvedValue([]);
    vi.mocked(listMemoryGovernance).mockResolvedValue({ ...governanceEmpty, memories: [governedMemory] });

    render(<MemoryPanel open projectId={projectId} onClose={vi.fn()} />);
    const edit = await screen.findByRole("button", { name: "Editar" });
    fireEvent.click(edit);

    const editor = screen.getByRole("textbox", { name: "Contenido de la memoria" });
    expect(editor).toHaveValue(governedMemory.content);
    expect(screen.getByText("Contenido de la memoria")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar edición" })).toBeEnabled());
  });

  it("hides stale governed records immediately and ignores a late project response", async () => {
    let resolveSecond: ((value: typeof governanceEmpty) => void) | undefined;
    vi.mocked(listExplicitMemories).mockResolvedValue([]);
    vi.mocked(listMemoryGovernance)
      .mockResolvedValueOnce({ ...governanceEmpty, memories: [governedMemory] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const view = render(<MemoryPanel open projectId={projectId} onClose={vi.fn()} />);
    expect(await screen.findByText(governedMemory.content)).toBeInTheDocument();

    view.rerender(<MemoryPanel open projectId={secondProjectId} onClose={vi.fn()} />);
    expect(screen.queryByText(governedMemory.content)).not.toBeInTheDocument();
    expect(screen.getByText("Actualizando memoria…")).toBeInTheDocument();

    resolveSecond?.(governanceEmpty);
    await waitFor(() => expect(listMemoryGovernance).toHaveBeenLastCalledWith(secondProjectId, expect.any(AbortSignal)));
    expect(screen.queryByText(governedMemory.content)).not.toBeInTheDocument();
  });
});
