// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentPreviewPanel } from "@/components/document-preview-panel";
import type { DocumentArtifact } from "@/lib/chat-contract";

afterEach(cleanup);

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

describe("DocumentPreviewPanel", () => {
  it("previews the private PDF and keeps download and close actions available", () => {
    const onClose = vi.fn();
    render(<DocumentPreviewPanel artifact={artifact} onClose={onClose} />);

    expect(screen.getByRole("complementary", { name: "Vista previa de informe-precios.pdf" })).toBeInTheDocument();
    expect(screen.getByTitle("Documento informe-precios.pdf")).toHaveAttribute("src", artifact.previewUrl);
    expect(screen.getByRole("link", { name: "Descargar informe-precios.pdf" })).toHaveAttribute("href", artifact.url);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar vista previa" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
