// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ServerPicker } from "@/components/server-picker";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const folder = { path: "server-arnall/Y/QA", name: "QA", kind: "directory", modifiedAt: null, size: 0, scope: "company" };
function reply(results: object[]) { return { ok: true, json: async () => ({ available: true, sourceChecked: true, checkedAt: new Date().toISOString(), results, nextQuery: null }) }; }
it("navigates, refreshes external changes and attaches folder references without reading content", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply([folder])).mockResolvedValueOnce(reply([{ ...folder, path: "server-arnall/Y/QA/New.txt", name: "New.txt", kind: "file" }])).mockResolvedValueOnce(reply([{ ...folder, path: "server-arnall/Y/QA/Changed.txt", name: "Changed.txt", kind: "file" }]));
  vi.stubGlobal("fetch", fetcher);
  const select = vi.fn(); const close = vi.fn();
  render(<ServerPicker projectId="project" selected={[]} onSelect={select} onClose={close}/>);
  fireEvent.click(await screen.findByLabelText("Adjuntar QA"));
  fireEvent.click(screen.getByRole("button", { name: "Abrir QA" }));
  await screen.findByText("New.txt");
  fireEvent.click(screen.getByLabelText("Actualizar desde Windows"));
  await screen.findByText("Changed.txt");
  expect(screen.queryByText("New.txt")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Adjuntar referencias" }));
  expect(select).toHaveBeenCalledWith([{ path: folder.path, name: "QA", kind: "directory", modifiedAt: null, size: 0 }]);
  expect(close).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("/api/server-files?"))).toBe(true);
});
it("does not present cached results as a live folder", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: true, sourceChecked: false, results: [folder] }) }));
  render(<ServerPicker projectId="project" selected={[]} onSelect={vi.fn()} onClose={vi.fn()}/>);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.queryByText("QA")).toBeNull();
});
