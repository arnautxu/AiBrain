// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownMessage, splitStreamingMarkdown } from "@/components/markdown-message";

describe("MarkdownMessage", () => {
  it("renders GFM tables, links, lists and labelled code blocks", () => {
    render(<MarkdownMessage>{[
      "## Resultado",
      "- Primer punto",
      "- Segundo punto",
      "  - Subpunto",
      "",
      "1. Paso uno",
      "2. Paso dos",
      "",
      "- [x] Validado",
      "",
      "Texto con ~~contenido anterior~~ y `código inline`.",
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
    expect(screen.getByText("Validado").closest("li")).toHaveClass("task-list-item");
    expect(screen.getByText("contenido anterior").tagName).toBe("DEL");
    expect(screen.getByText("código inline").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "Referencia" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Copiar bloque de código" })).toBeInTheDocument();
    expect(screen.getByText("const ready = true;")).toBeInTheDocument();
  });

  it("shows streamed prose immediately with one lightweight caret and no word wrappers", () => {
    const longAnswer = Array.from({ length: 1_000 }, (_, index) => `palabra-${index}`).join(" ");
    const { container, rerender } = render(
      <MarkdownMessage streaming>{longAnswer}</MarkdownMessage>,
    );

    expect(container.querySelector(".t-stream")).toBeInTheDocument();
    expect(container.querySelectorAll(".t-stream-w")).toHaveLength(0);
    expect(container.querySelectorAll(".t-stream-caret")).toHaveLength(1);
    expect(container.textContent).toContain("palabra-999");

    rerender(<MarkdownMessage>{longAnswer}</MarkdownMessage>);
    expect(container.querySelector(".t-stream-caret")).not.toBeInTheDocument();
  });

  it("freezes completed Markdown blocks but keeps fenced code together", () => {
    expect(splitStreamingMarkdown([
      "Primer párrafo.",
      "",
      "Segundo párrafo.",
      "",
      "```ts",
      "const first = true;",
      "",
      "const second = true;",
      "```",
      "",
      "Final en curso",
    ].join("\n"))).toEqual([
      "Primer párrafo.",
      "Segundo párrafo.",
      "```ts\nconst first = true;\n\nconst second = true;\n```",
      "Final en curso",
    ]);
  });
});
