// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportDialog } from "@/components/support-dialog";

function SupportDialogHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Abrir ayuda</button>
    <SupportDialog open={open} projectId="project-1" threadId="thread-1" onClose={() => setOpen(false)} />
  </>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SupportDialog", () => {
  it("preserves the draft but clears transient errors when reopened", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Error temporal" }, { status: 500 })));
    render(<SupportDialogHarness />);

    const opener = screen.getByRole("button", { name: "Abrir ayuda" });
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Bug" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Descripción" }), {
      target: { value: "El panel no responde" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Error temporal"));

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.click(opener);

    expect(screen.getByRole("button", { name: "Bug" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Descripción" })).toHaveValue("El panel no responde");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
