// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryPanel } from "@/components/library-panel";
import type { WorkbenchProject, WorkbenchThread } from "@/workbench/types";

const PROJECT_ID = "0198b9f0-6631-7000-8000-000000000701";
const WORKSPACE_ID = "0198b9f0-6631-7000-8000-000000000702";
const THREAD_ID = "0198b9f0-6631-7000-8000-000000000703";
const MESSAGE_ID = "0198b9f0-6631-7000-8000-000000000704";
const DOCUMENT_ID = "0198b9f0-6631-7000-8000-000000000705";
const USER_ID = "0198b9f0-6631-7000-8000-000000000706";
const createdAt = "2026-08-30T08:00:00.000Z";

const project: WorkbenchProject = {
  id: PROJECT_ID,
  name: "Operaciones",
  slug: "operaciones",
  status: "active",
  pinned: false,
  instructions: "",
  sources: [],
  memory: { enabled: true, notes: "", updatedAt: null },
  sharing: { visibility: "private", members: [] },
  workspace: { id: WORKSPACE_ID, label: "Operaciones", hostType: "managed", status: "ready", isPrimary: true },
  createdAt,
  updatedAt: createdAt,
};

const thread: WorkbenchThread = {
  id: THREAD_ID,
  projectId: PROJECT_ID,
  title: "Brief",
  status: "active",
  pinned: false,
  createdAt,
  updatedAt: createdAt,
  messages: [{
    id: MESSAGE_ID,
    role: "user",
    content: "Revisa el brief",
    createdAt,
    status: "complete",
    activity: [],
    plan: [],
    approvals: [],
    diff: "",
    artifacts: [],
    attachments: [{
      id: DOCUMENT_ID,
      name: "brief.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 4_096,
    }],
  }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Library document roundtrip", () => {
  it("uses the Office PDF representation and exposes immutable history and re-upload", async () => {
    const previewUrl = `/api/threads/${THREAD_ID}/documents/${DOCUMENT_ID}/versions/${DOCUMENT_ID}/preview/document.pdf`;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/library") return Response.json({ items: [] }, { status: 503 });
      if (url === `/api/threads/${THREAD_ID}/documents/${DOCUMENT_ID}`) {
        return Response.json({ document: {
          documentId: DOCUMENT_ID,
          threadId: THREAD_ID,
          title: "brief.docx",
          scope: { kind: "project", id: PROJECT_ID },
          originalVersionId: DOCUMENT_ID,
          latestVersionId: DOCUMENT_ID,
          versions: [{
            versionId: DOCUMENT_ID,
            number: 1,
            etag: "a".repeat(64),
            fileName: "brief.docx",
            kind: "docx",
            mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 4_096,
            author: { userId: USER_ID, name: "David" },
            createdAt,
            provenance: { type: "original_upload", sourceVersionId: null },
            downloadUrl: `/api/threads/${THREAD_ID}/documents/${DOCUMENT_ID}/versions/${DOCUMENT_ID}`,
            previewUrl,
          }],
        } });
      }
      if (url === previewUrl) {
        return new Response("%PDF-1.7\nfixture", { headers: { "Content-Type": "application/pdf", "Content-Length": "16" } });
      }
      return Response.json({ error: "unexpected" }, { status: 404 });
    }));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:https://brain.example/office"), revokeObjectURL: vi.fn() });

    render(<LibraryPanel
      open
      projects={[project]}
      threads={[thread]}
      onClose={vi.fn()}
      onOpenConversation={vi.fn()}
    />);

    expect(await screen.findByTitle("Vista previa de brief.docx")).toHaveAttribute("src", "blob:https://brain.example/office");
    expect(screen.getByLabelText("Historial de versiones del documento")).toHaveTextContent("v1 · brief.docx · actual");
    expect(screen.getByRole("button", { name: "Subir versión editada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Descargar original" })).toHaveAttribute(
      "href",
      `/api/threads/${THREAD_ID}/documents/${DOCUMENT_ID}/versions/${DOCUMENT_ID}`,
    );
  });
});
