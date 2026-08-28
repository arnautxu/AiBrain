// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useTaskCenterShortcut } from "@/components/use-task-center-shortcut";

afterEach(cleanup);

function TaskCenterShortcutHarness() {
  const [open, setOpen] = useState(false);
  useTaskCenterShortcut(() => setOpen((current) => !current));
  return <div role="status">{open ? "Centro de tareas abierto" : "Centro de tareas cerrado"}</div>;
}

describe("useTaskCenterShortcut", () => {
  it("opens with Cmd+Option+U and closes with Ctrl+Alt+U", () => {
    render(<TaskCenterShortcutHarness />);

    fireEvent.keyDown(window, { metaKey: true, altKey: true, code: "KeyU" });
    expect(screen.getByRole("status")).toHaveTextContent("Centro de tareas abierto");

    fireEvent.keyDown(window, { ctrlKey: true, altKey: true, code: "KeyU" });
    expect(screen.getByRole("status")).toHaveTextContent("Centro de tareas cerrado");
  });
});
