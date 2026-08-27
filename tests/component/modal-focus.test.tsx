// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { TextDialog } from "@/components/workbench-dialogs";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir diálogo</button>
      <TextDialog
        open={open}
        title="Nuevo proyecto"
        label="Nombre"
        submitLabel="Crear"
        busy={false}
        onClose={() => setOpen(false)}
        onSubmit={() => setOpen(false)}
      />
    </>
  );
}

describe("modal focus", () => {
  it("focuses the requested field, traps Tab and restores the opener on Escape", async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Abrir diálogo" });
    opener.focus();
    fireEvent.click(opener);
    const input = screen.getByRole("textbox", { name: "Nombre" });
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.change(input, { target: { value: "Proyecto sintético" } });
    const submit = screen.getByRole("button", { name: "Crear" });
    submit.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
