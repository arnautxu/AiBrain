// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentPreviewPanel } from "@/components/document-preview-panel";
import { AuthenticatedSpreadsheetPreview, SpreadsheetTable } from "@/components/authenticated-spreadsheet-preview";
import type { SpreadsheetPreview } from "@/documents/spreadsheet-preview";

const preview: SpreadsheetPreview = { schemaVersion: 1, kind: "spreadsheet", truncated: false, sheets: [
  { name: "S’Agaró", hidden: false, cells: [{ address: "A1", value: "<script>unsafe()</script>" }, { address: "C3", value: "09:00" }] },
  { name: "Torre", hidden: true, cells: [{ address: "B9", value: "17:00" }] },
] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens a spreadsheet inside the document panel with escaped values and sheet navigation", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(preview), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  render(<DocumentPreviewPanel artifact={{ id: "00000000-0000-4000-8000-000000000099", type: "document", name: "Horaris.xlsm",
    kind: "text", mimeType: "application/json", size: 500, status: "ready", pages: null, previewFormat: "spreadsheet",
    url: "/api/projects/test/files?download=1", previewUrl: "/api/projects/test/files?download=1",
    publicationStatus: null, publicationError: null, targetLabel: null, error: null }} onClose={vi.fn()} />);
  expect(await screen.findByRole("cell", { name: "09:00" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "<script>unsafe()</script>" })).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByRole("columnheader", { name: "C" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Descargar datos de la vista previa" })).toHaveAttribute("download", "Horaris.xlsm.preview.json");
  fireEvent.change(screen.getByRole("combobox", { name: "Hoja del libro" }), { target: { value: "1" } });
  expect(screen.getByRole("cell", { name: "17:00" })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/projects/"), expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
});

it("recovers from an unavailable route", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("denied", { status: 403 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(preview), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  render(<AuthenticatedSpreadsheetPreview previewUrl="/api/projects/test/files" />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("cell", { name: "09:00" })).toBeInTheDocument();
});

it.each(["x".repeat(100001), JSON.stringify({ ...preview, sheets: [] }), JSON.stringify({ ...preview,
  sheets: [{ ...preview.sheets[0], cells: [{ address: "A1", value: "one" }, { address: "A1", value: "two" }] }],
})])("rejects oversized and malformed response data", async (body) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json" } })));
  render(<AuthenticatedSpreadsheetPreview previewUrl="/api/projects/test/files" />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("never fetches external preview URLs", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<AuthenticatedSpreadsheetPreview previewUrl="https://invalid.test/private" />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("bounds the DOM and exposes partial and empty states", () => {
  render(<SpreadsheetTable preview={{ ...preview, truncated: true, sheets: [
    { name: "Large", hidden: false, cells: Array.from({ length: 120 }, (_, i) => ({ address: `A${i + 1}`, value: `Value ${i + 1}` })) },
    { name: "Empty", hidden: false, cells: [] },
  ] }} />);
  expect(screen.getAllByRole("cell")).toHaveLength(50);
  expect(screen.getByRole("status")).toHaveTextContent("Vista parcial");
  fireEvent.click(screen.getByRole("button", { name: "Más filas" }));
  expect(screen.getByRole("cell", { name: "Value 51" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
  expect(screen.getByText(/No hay celdas/)).toBeInTheDocument();
});
