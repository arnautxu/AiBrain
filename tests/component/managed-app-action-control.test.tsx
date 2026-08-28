// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedAppActionControl } from "@/components/managed-app-action-control";
import type { ChatMessage } from "@/lib/chat-contract";

const message: ChatMessage = {
  id: "turn-current",
  role: "assistant",
  content: "Resultado visible",
  status: "complete",
  createdAt: "2026-08-28T12:00:00.000Z",
  activity: [], plan: [], approvals: [], diff: "", attachments: [], artifacts: [], sources: [], toolResults: [],
};

const descriptor = {
  operation: "execute-allowlisted-action",
  locator: { threadId: "thread-current", turnId: "turn-current", itemId: "turn-current", approvalId: "turn-current" },
  authorizationFingerprint: "a".repeat(64),
  approval: {
    id: "turn-current", threadId: "thread-current", turnId: "turn-current", itemId: "turn-current",
    kind: "command", title: "Confirmar acción conectada", detail: "Ejecutar la acción aprobada de la aplicación conectada.", status: "pending",
  },
} as const;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ManagedAppActionControl", () => {
  it("has no consumer until the connected capability gate is true", () => {
    const { rerender } = render(<ManagedAppActionControl enabled={false} threadId="thread-current" message={message} onPrepared={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Solicitar aprobación" })).not.toBeInTheDocument();

    rerender(<ManagedAppActionControl enabled threadId="thread-current" message={message} onPrepared={() => undefined} />);
    expect(screen.getByRole("button", { name: "Solicitar aprobación" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Acción conectada" })).toBeVisible();
  });

  it("prepares only the active thread/turn descriptor and exposes its pending approval", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ schemaVersion: 1, descriptor })));
    vi.stubGlobal("fetch", fetcher);
    const onPrepared = vi.fn();
    render(<ManagedAppActionControl enabled threadId="thread-current" message={message} onPrepared={onPrepared} />);

    fireEvent.click(screen.getByRole("button", { name: "Solicitar aprobación" }));
    await waitFor(() => expect(onPrepared).toHaveBeenCalledWith(descriptor));
    expect(fetcher).toHaveBeenCalledWith("/api/connectors/codex-managed-app/action", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ operation: "prepare", ...descriptor.locator });
  });
});
