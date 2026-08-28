// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "@/components/markdown-message";

describe("MarkdownMessage", () => {
  it("renders GFM tables, links, lists and labelled code blocks", () => {
    render(<MarkdownMessage>{[
      "## Resultado",
      "- Primer punto",
      "- Segundo punto",
      "",
      "| Estado | Valor |",
      "| --- | --- |",
      "| Listo | Sí |",
      "",
      "[Referencia](https://example.test)",
      "",
      "```ts",
      "const ready = true;",
      "```",
    ].join("\n")}</MarkdownMessage>);

    expect(screen.getByRole("heading", { name: "Resultado" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Referencia" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Copiar bloque de código" })).toBeInTheDocument();
    expect(screen.getByText("const ready = true;")).toBeInTheDocument();
  });

  it("reveals streamed prose word by word without animating code", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <MarkdownMessage streaming>{"Primera segunda\n\n`constante`"}</MarkdownMessage>,
      );

      expect(container.querySelector(".t-stream")).toBeInTheDocument();
      expect(container.querySelectorAll(".t-stream-w")).toHaveLength(2);
      expect(container.querySelectorAll(".t-stream-w.is-in")).toHaveLength(0);
      act(() => vi.advanceTimersByTime(60));
      expect(container.querySelectorAll(".t-stream-w.is-in")).toHaveLength(1);
      expect(container.querySelector("code")?.className).not.toContain("t-stream-w");
    } finally {
      vi.useRealTimers();
    }
  });
});
