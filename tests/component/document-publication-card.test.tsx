// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentPublicationCard } from "@/components/document-publication-card";
import type { DocumentPublicationDraft } from "@/ui/publication-ui-adapter";

const draft: DocumentPublicationDraft = {
  id: "0198b9f0-6631-7000-8000-000000000511",
  threadId: "0198b9f0-6631-7000-8000-000000000302",
  turnId: "0198b9f0-6631-7000-8000-000000000612",
  uploadId: "0198b9f0-6631-7000-8000-000000000511",
  fileName: "notes.md",
  size: 17,
  targetRelativePath: "knowledge/notes.md",
  phase: "ready",
  operation: null,
  confirmationToken: null,
  permissionFingerprint: null,
  error: null,
};

afterEach(cleanup);

describe("DocumentPublicationCard", () => {
  it("collects a safe destination before freezing the candidate", () => {
    const onFreeze = vi.fn(async () => undefined);
    render(<DocumentPublicationCard draft={draft} onFreeze={onFreeze} onDecide={vi.fn()} />);

    const destination = screen.getByRole("textbox", { name: "Destino de notes.md" });
    fireEvent.change(destination, { target: { value: "official/notes.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Preparar publicación" }));
    expect(onFreeze).toHaveBeenCalledWith(draft.id, "official/notes.md");

    fireEvent.change(destination, { target: { value: "../private.md" } });
    expect(screen.getByRole("button", { name: "Preparar publicación" })).toBeDisabled();
  });

  it("keeps a failed decision explicit without losing the confirmation controls", () => {
    const onDecide = vi.fn(async () => undefined);
    render(<DocumentPublicationCard
      draft={{
        ...draft,
        phase: "awaiting_confirmation",
        error: "La conexión se ha interrumpido.",
        operation: {
          schemaVersion: 1,
          operationId: "0198b9f0-6631-7000-8000-000000000615",
          threadId: draft.threadId,
          turnId: draft.turnId,
          targetRelativePath: draft.targetRelativePath,
          status: "awaiting_confirmation",
          candidate: { fileName: draft.fileName, size: draft.size, sha256: "a".repeat(64) },
          original: { exists: false, size: null, sha256: null, mtimeMs: null },
          confirmationExpiresAt: "2026-08-27T10:10:00.000Z",
          version: null,
          result: null,
        },
      }}
      onFreeze={vi.fn()}
      onDecide={onDecide}
    />);

    expect(screen.getByRole("alert")).toHaveTextContent("La conexión se ha interrumpido.");
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    expect(onDecide).toHaveBeenCalledWith(draft.id, "confirm");
  });
});
