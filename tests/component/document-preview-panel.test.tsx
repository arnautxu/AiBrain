// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentPreviewPanel } from "@/components/document-preview-panel";
import type { DocumentArtifact } from "@/lib/chat-contract";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const artifact: DocumentArtifact = {
  id: "018f5f68-4a6e-7abc-8def-0123456789ae",
  type: "document",
  name: "informe-precios.pdf",
  url: "/api/projects/project/files?path=informe.pdf&raw=1&download=1",
  kind: "pdf",
  mimeType: "application/pdf",
  size: 4096,
  status: "ready",
  pages: 4,
  previewUrl: "/api/projects/project/files?path=informe.pdf&raw=1",
  publicationStatus: null,
  publicationError: null,
  targetLabel: null,
  error: null,
};

function MobilePreviewHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir documento</button>
      {open ? <DocumentPreviewPanel artifact={artifact} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

describe("DocumentPreviewPanel", () => {
  it("resets a failed preview when selecting another document", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:second", revokeObjectURL: vi.fn() });
    const { rerender } = render(<DocumentPreviewPanel artifact={artifact} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se ha podido mostrar el PDF");
    rerender(<DocumentPreviewPanel artifact={{ ...artifact, id: "second", name: "second.pdf", previewUrl: "/api/projects/project/files?path=second.pdf&raw=1" }} onClose={vi.fn()} />);
    expect(await screen.findByTitle("Documento second.pdf")).toHaveAttribute("src", "blob:second");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("previews the private PDF blob and keeps download and close actions available", async () => {
    const onClose = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("%PDF-1.7\\n%%EOF", {
      headers: { "Content-Length": "14", "Content-Type": "application/pdf" },
    })));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:https://brain.example/document"), revokeObjectURL: vi.fn() });
    render(<DocumentPreviewPanel artifact={artifact} onClose={onClose} />);

    expect(screen.getByRole("complementary", { name: "Vista previa de informe-precios.pdf" })).toBeInTheDocument();
    expect(await screen.findByTitle("Documento informe-precios.pdf")).toHaveAttribute("src", "blob:https://brain.example/document");
    expect(screen.getByRole("link", { name: "Descargar informe-precios.pdf" })).toHaveAttribute("href", artifact.url);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar vista previa" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not leave an unavailable PDF in an endless loading state", () => {
    render(<DocumentPreviewPanel artifact={{ ...artifact, previewUrl: null }} onClose={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("No se ha podido mostrar el PDF");
    expect(screen.queryByRole("status", { name: "Cargando vista previa del PDF" })).not.toBeInTheDocument();
  });

  it("renders a text document as escaped authenticated text instead of an iframe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<script>unsafe()</script>\nVisible text", {
      headers: { "Content-Length": "37", "Content-Type": "text/plain" },
    })));
    render(<DocumentPreviewPanel artifact={{
      ...artifact,
      kind: "text",
      mimeType: "text/plain",
      name: "notes.txt",
      previewUrl: "/api/threads/thread/documents/upload/preview/preview.txt",
    }} onClose={vi.fn()} />);

    expect(await screen.findByLabelText("Documento notes.txt")).toHaveTextContent("<script>unsafe()</script>");
    expect(screen.queryByTitle("Documento notes.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Descargar notes.txt" })).toBeInTheDocument();
  });

  it("behaves as a focus-managed modal on mobile and restores its opener", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("%PDF-1.7\\n%%EOF", {
      headers: { "Content-Length": "14", "Content-Type": "application/pdf" },
    })));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:https://brain.example/document"), revokeObjectURL: vi.fn() });
    render(<MobilePreviewHarness />);

    const opener = screen.getByRole("button", { name: "Abrir documento" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Vista previa de informe-precios.pdf" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cerrar vista previa" })).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Vista previa de informe-precios.pdf" })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("offers persisted page navigation, zoom and document-only fullscreen", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), {
      headers: { "Content-Type": "image/png", "Content-Length": "5" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:page"), revokeObjectURL: vi.fn() });
    render(<DocumentPreviewPanel artifact={{
      ...artifact,
      id: "00000000-0000-4000-8000-000000000099",
      pages: 3,
      previewUrl: "/api/threads/00000000-0000-4000-8000-000000000013/artifacts/00000000-0000-4000-8000-000000000099?preview=1",
      url: "/api/threads/00000000-0000-4000-8000-000000000013/artifacts/00000000-0000-4000-8000-000000000099?download=1",
    }} onClose={vi.fn()} />);

    const first = await screen.findByRole("img", { name: "Documento informe-precios.pdf, página 1" });
    fireEvent.load(first);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("page=1"), expect.objectContaining({ credentials: "same-origin" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Página siguiente" })[0]!);
    expect(await screen.findByRole("img", { name: "Documento informe-precios.pdf, página 2" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("page=2"), expect.anything());
    fireEvent.click(screen.getAllByRole("button", { name: "Acercar" })[0]!);
    expect(screen.getAllByText("125%").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Pantalla completa" }));
    expect(screen.getByRole("complementary")).toHaveClass("xl:fixed");
    expect(screen.getByRole("link", { name: "Descargar informe-precios.pdf" })).toHaveAttribute("href", expect.stringContaining("/api/threads/"));
  });
});
