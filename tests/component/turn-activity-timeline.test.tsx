// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import orderGolden from "../golden/turn-activity-order.json";
import { turnActivityScenarios } from "../fixtures/turn-activity-scenarios";
import { TurnActivity } from "@/components/turn-activity";

afterEach(cleanup);

describe("TurnActivity timeline", () => {
  it("starts expanded while running and interleaves compact tool cards in transport order", () => {
    const { container } = render(
      <TurnActivity message={turnActivityScenarios.multipleTools} onResolveApproval={vi.fn()} />,
    );
    const trigger = screen.getByRole("button", { name: "Ocultar el proceso de trabajo" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect([...container.querySelectorAll("[data-timeline-key]")].map((node) =>
      node.getAttribute("data-timeline-key"))).toEqual(orderGolden.multipleTools);

    const commandCard = screen.getByText("npm test").closest("details");
    expect(commandCard).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("npm test"));
    expect(commandCard).toHaveAttribute("open");
    expect(screen.getByLabelText("Salida de npm test")).toHaveTextContent("12 pruebas superadas");
  });

  it("collapses completed recovery activity under the measured duration", () => {
    render(<TurnActivity message={turnActivityScenarios.errorRecovery} onResolveApproval={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Mostrar el proceso de trabajo" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("Ha trabajado durante 1m 32s");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "Actividad del trabajo" })).toBeInTheDocument();
    expect(screen.getByText("He recuperado el turno durable sin repetir la acción incierta")).toBeInTheDocument();
    expect(screen.getByText("CRM · Consulta inicial")).toBeInTheDocument();
  });

  it.each(["text", "web"] as const)("renders the %s fixture without exposing private reasoning", (scenarioName) => {
    render(<TurnActivity message={turnActivityScenarios[scenarioName]} onResolveApproval={vi.fn()} />);
    expect(screen.queryByText(/chain[- ]of[- ]thought|razonamiento privado/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("turn-thinking-steps")).toBeInTheDocument();
  });
});
