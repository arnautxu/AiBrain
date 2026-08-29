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

  it("shows streamed prose immediately and settles the newest words without animating code", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <MarkdownMessage streaming>{"Primera segunda tercera\n\n`constante`"}</MarkdownMessage>,
      );

      expect(container.querySelector(".t-stream")).toBeInTheDocument();
      expect(container.querySelectorAll(".t-stream-w")).toHaveLength(3);
      expect(container.querySelectorAll(".t-stream-w.is-fresh")).toHaveLength(2);
      expect(container.querySelectorAll(".t-stream-w.is-settled")).toHaveLength(1);
      expect(container.querySelector(".t-stream-caret")).toBeInTheDocument();
      expect(container.querySelector("code")?.className).not.toContain("t-stream-w");

      rerender(<MarkdownMessage streaming>{"Primera segunda tercera quarta quinta\n\n`constante`"}</MarkdownMessage>);
      expect(container.querySelectorAll(".t-stream-w")).toHaveLength(5);
      expect(container.querySelectorAll(".t-stream-w.is-fresh")).toHaveLength(2);
      expect(container.textContent).toContain("Primera segunda tercera quarta quinta");

      rerender(<MarkdownMessage>{"Primera segunda tercera quarta quinta\n\n`constante`"}</MarkdownMessage>);
      expect(container.querySelectorAll(".t-stream-w.is-fresh")).toHaveLength(0);
      expect(container.querySelectorAll(".t-stream-w.is-settled")).toHaveLength(5);
      expect(container.querySelector(".t-stream-caret")).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(700));
      expect(container.querySelectorAll(".t-stream-w")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
