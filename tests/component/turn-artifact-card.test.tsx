// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnArtifactCard } from "@/components/turn-artifact-card";
import type { BrowserArtifact, DocumentArtifact } from "@/lib/chat-contract";

afterEach(cleanup);

const documentArtifact: DocumentArtifact = {
  id: "018f5f68-4a6e-7abc-8def-0123456789ae",
  type: "document",
  name: "informe.pdf",
  url: "/api/projects/project/artifacts/document",
  kind: "pdf",
  mimeType: "application/pdf",
  size: 2048,
  status: "ready",
  pages: 3,
  previewUrl: "/api/projects/project/artifacts/document/preview/1",
  publicationStatus: "awaiting_confirmation",
  publicationError: null,
  targetLabel: "Informes/informe.pdf",
  error: null,
};

describe("TurnArtifactCard", () => {
  it("shows a safe Office/PDF preview and an honest publication state", () => {
    const onPreview = vi.fn();
    render(<TurnArtifactCard artifact={documentArtifact} onPreviewDocument={onPreview} />);
    expect(screen.getByRole("heading", { name: "informe.pdf" })).toBeInTheDocument();
    screen.getByRole("button", { name: "Previsualizar informe.pdf" }).click();
    expect(onPreview).toHaveBeenCalledWith(documentArtifact);
    expect(screen.getByRole("button", { name: "Revisar antes de descargar" })).toBeInTheDocument();
    expect(screen.getByText("Pendiente de confirmación segura")).toBeInTheDocument();
    expect(screen.getByText("Informes/informe.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Descargar informe.pdf" })).toHaveAttribute("href", documentArtifact.url);
  });

  it("announces document conversion errors", () => {
    render(<TurnArtifactCard artifact={{ ...documentArtifact, status: "error", previewUrl: null, publicationStatus: null, error: "El PDF está cifrado." }} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("El PDF está cifrado.");
    expect(alert).toHaveClass("text-body-2-medium");
  });

  it.each([
    ["docx", "DOCX"],
    ["xlsx", "XLSX"],
    ["pptx", "PPTX"],
  ] as const)("shows %s metadata after server-side conversion", (kind, label) => {
    render(<TurnArtifactCard artifact={{ ...documentArtifact, kind, name: `informe.${kind}`, pages: 1 }} />);
    expect(screen.getByText(new RegExp(`^${label} ·`))).toBeInTheDocument();
    expect(screen.getByText("Vista previa ›")).toBeInTheDocument();
    expect(screen.getByText(new RegExp("1 página$"))).toBeInTheDocument();
  });

  it.each([
    ["publishing", "Publicando…"],
    ["published", "Publicado y versionado"],
    ["declined", "Publicación rechazada"],
    ["conflict", "Conflicto: el original ha cambiado"],
  ] as const)("shows the %s publication lifecycle state", (publicationStatus, label) => {
    render(<TurnArtifactCard artifact={{ ...documentArtifact, publicationStatus }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("announces publication failures without claiming success", () => {
    render(<TurnArtifactCard artifact={{ ...documentArtifact, publicationStatus: null, publicationError: "No se ha podido publicar." }} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No se ha podido publicar.");
    expect(alert).toHaveClass("text-body-2-medium");
  });

  it("renders a generated image through the image generation component", () => {
    render(<TurnArtifactCard artifact={{
      id: "018f5f68-4a6e-7abc-8def-0123456789ad",
      type: "image",
      name: "diagrama.png",
      url: "/api/projects/project/artifacts/image",
      prompt: "Un diagrama verificable",
    }} />);

    expect(document.querySelector("[data-slot='image-generation']")).toBeInTheDocument();
    const image = screen.getByRole("img", { name: "Un diagrama verificable" });
    expect(image).toHaveAttribute("src", "/api/projects/project/artifacts/image");
    expect(image).toHaveClass("object-contain");
    expect(image).not.toHaveClass("object-cover");
    expect(screen.getByRole("link", { name: "Descargar diagrama.png" })).toHaveAttribute("href", "/api/projects/project/artifacts/image?download=1");
    expect(screen.queryByRole("button", { name: "Volver a generar la imagen" })).not.toBeInTheDocument();
  });

  it("links only to the supplied isolated browser viewer route", () => {
    const browser: BrowserArtifact = {
      id: "018f5f68-4a6e-7abc-8def-0123456789af",
      type: "browser",
      name: "Comprobación web",
      status: "active",
      control: "employee",
      viewerUrl: "/api/browser/sessions/018f5f68-4a6e-7abc-8def-0123456789af/viewer",
      captureUrl: null,
      downloadUrl: "/api/browser/sessions/018f5f68-4a6e-7abc-8def-0123456789af/download",
      error: null,
    };
    render(<TurnArtifactCard artifact={browser} />);
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", browser.viewerUrl);
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText("Tienes el control")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Descargar resultado" })).toBeInTheDocument();
  });

  it("reopens a historical browser artifact from the whole card header", () => {
    const onOpenBrowser = vi.fn();
    render(<TurnArtifactCard onOpenBrowser={onOpenBrowser} artifact={{
      id: "018f5f68-4a6e-7abc-8def-0123456789af",
      type: "browser",
      name: "Navegador · Wikipedia",
      status: "closed",
      control: null,
      viewerUrl: null,
      captureUrl: null,
      downloadUrl: null,
      error: null,
    }} />);
    screen.getByRole("button", { name: "Reabrir Navegador · Wikipedia" }).click();
    expect(onOpenBrowser).toHaveBeenCalledOnce();
  });

  it.each([
    ["starting", "Iniciando navegador…"],
    ["reconnecting", "Reconectando…"],
    ["disconnected", "Sesión desconectada"],
    ["closed", "Viewer cerrado"],
    ["error", "Error de sesión"],
  ] as const)("announces the %s browser lifecycle state", (status, label) => {
    render(<TurnArtifactCard artifact={{
      id: "018f5f68-4a6e-7abc-8def-0123456789af",
      type: "browser",
      name: "Comprobación web",
      status,
      control: status === "reconnecting" ? "awaiting_approval" : null,
      viewerUrl: null,
      captureUrl: null,
      downloadUrl: null,
      error: status === "error" ? "El navegador no está disponible." : null,
    }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    if (status === "reconnecting") expect(screen.getByText("Aprobación pendiente")).toBeInTheDocument();
    if (status === "error") expect(screen.getByRole("alert")).toHaveTextContent("El navegador no está disponible.");
  });
});
