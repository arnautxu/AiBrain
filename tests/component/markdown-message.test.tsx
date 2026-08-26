// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
