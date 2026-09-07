// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { UiLocaleProvider, useUiText } from "./provider";
import { translate } from "./messages";
import { LandingTasks } from "@/components/landing-tasks";
import { scheduledPromptTemplates } from "@/lib/landing-suggestions";
import { InstallationLanguage } from "@/components/installation-language";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function Example({ content }: { content: string }) { const t = useUiText(); return <><button>{t("Proyecto")}</button><p data-testid="customer-content">{content}</p><p>{t("Rol de {p0}", { p0: content })}</p></>; }
function Tasks({ onSelect }: { onSelect: (text: string) => void }) { const t = useUiText(); return <LandingTasks tasks={scheduledPromptTemplates("Empresa Proyecto", t)} variant="menu" disabled={false} onSelect={onSelect} />; }
describe("installation interface language", () => {
  it("defaults to English and refreshes every consumer without translating customer text", () => {
    const content = "Proyecto: conserva mi texto en español.";
    const view = render(<Example content={content} />);
    expect(screen.getByRole("button", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByTestId("customer-content")).toHaveTextContent(content);
    view.rerender(<UiLocaleProvider locale="es"><Example content={content} /></UiLocaleProvider>);
    expect(screen.getByRole("button", { name: "Proyecto" })).toBeInTheDocument();
    expect(screen.getByTestId("customer-content")).toHaveTextContent(content);
    expect(screen.getByText(`Rol de ${content}`)).toBeInTheDocument();
  });
  it("server-renders the chosen language and treats inserted values as opaque text", () => {
    expect(renderToString(<UiLocaleProvider locale="es"><Example content="<script>Proyecto</script>" /></UiLocaleProvider>)).toContain("&lt;script&gt;Proyecto&lt;/script&gt;");
    expect(translate("en", "Rol de {p0}", { p0: "{p1}" })).toBe("Role for {p1}");
    expect(translate("es", "Correu o contrasenya incorrectes.")).toBe("Correo o contraseña incorrectos.");
    expect(translate("en", "Correu o contrasenya incorrectes.")).toBe("Incorrect email or password.");
  });
  it("localizes built-in recurring prompts while preserving the company name", async () => {
    const select = vi.fn(); render(<Tasks onSelect={select} />);
    fireEvent.click(screen.getByRole("button", { name: "Recurring tasks" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Work on team schedules for Empresa Proyecto" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Review schedule changes" }));
    expect(select).toHaveBeenCalledWith("Review team schedule changes for Empresa Proyecto for…");
  });
  it("refreshes only after an acknowledged company preference write", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ locale: "es" }), { status: 200 })); vi.stubGlobal("fetch", fetch);
    render(<InstallationLanguage />);
    fireEvent.change(screen.getByRole("combobox", { name: "Company interface language" }), { target: { value: "es" } });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith("/api/admin/language", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ locale: "es" }) }));
  });
});
