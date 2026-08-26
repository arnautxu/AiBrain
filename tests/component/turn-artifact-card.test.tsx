// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
    render(<TurnArtifactCard artifact={documentArtifact} />);
    expect(screen.getByRole("heading", { name: "informe.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Vista previa de informe.pdf" })).toBeInTheDocument();
    expect(screen.getByText("Pendiente de confirmación segura")).toBeInTheDocument();
    expect(screen.getByText("Destino: Informes/informe.pdf")).toBeInTheDocument();
  });

  it("announces document conversion errors", () => {
    render(<TurnArtifactCard artifact={{ ...documentArtifact, status: "error", previewUrl: null, publicationStatus: null, error: "El PDF está cifrado." }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("El PDF está cifrado.");
  });

  it.each([
    ["docx", "DOCX"],
    ["xlsx", "XLSX"],
    ["pptx", "PPTX"],
  ] as const)("shows %s metadata after server-side conversion", (kind, label) => {
    render(<TurnArtifactCard artifact={{ ...documentArtifact, kind, name: `informe.${kind}`, pages: 1 }} />);
    expect(screen.getByText(new RegExp(`^${label} ·`))).toBeInTheDocument();
    expect(screen.getByText("Vista previa · Página 1 de 1")).toBeInTheDocument();
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
    expect(screen.getByRole("alert")).toHaveTextContent("No se ha podido publicar.");
  });

  it("embeds only the supplied isolated browser viewer route", () => {
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
    expect(screen.getByTitle("Sesión de navegador: Comprobación web")).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-pointer-lock");
    expect(screen.getByText("Tienes el control")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Descargar resultado" })).toBeInTheDocument();
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
