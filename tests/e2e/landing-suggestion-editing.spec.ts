import { expect, test } from "@playwright/test";
import { establishDemoSession } from "../helpers/playwright-auth";

test.setTimeout(60_000);

const suggestions = [
  { button: "Prepárame una presentación", prompt: "Prepárame una presentación sobre…" },
  { button: "Trabajemos con estos Excels", prompt: "Trabajemos con estos Excels. Quiero…" },
  { button: /Trabajemos en los horarios/, child: "Dame los horarios preparados", prompt: "Dame los horarios preparados del equipo de Example Laboratory para…" },
];

for (const width of [390, 1440]) for (const suggestion of suggestions) {
  test(`suggestion ${suggestion.prompt} preserves native editing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await establishDemoSession(page, "example-user");
    const input = page.getByRole("textbox", { name: "Mensaje", exact: true });
    await page.getByRole("button", { name: suggestion.button, exact: true }).click();
    if (suggestion.child) await page.getByRole("menuitem", { name: suggestion.child, exact: true }).click();
    await expect(input).toHaveValue(suggestion.prompt);
    await expect(input).toBeFocused();
    await expect.poll(() => input.evaluate(el => (el as HTMLTextAreaElement).selectionStart)).toBe(suggestion.prompt.length);

    // A real pointer click must survive the focus/select React renders.
    await input.click({ position: { x: 80, y: 22 } });
    const caret = await input.evaluate(el => (el as HTMLTextAreaElement).selectionStart);
    expect(caret).toBeGreaterThan(0);
    expect(caret).toBeLessThan(suggestion.prompt.length);
    await input.pressSequentially(" aquí ");
    const edited = `${suggestion.prompt.slice(0, caret)} aquí ${suggestion.prompt.slice(caret)}`;
    await expect(input).toHaveValue(edited);

    // Losing focus and returning must not reset the next insertion to the start.
    await page.getByRole("heading", { level: 1 }).click();
    await input.click({ position: { x: 80, y: 22 } });
    const nextCaret = await input.evaluate(el => (el as HTMLTextAreaElement).selectionStart);
    expect(nextCaret).toBeGreaterThan(0);
    await input.pressSequentially("text ");
    await expect(input).toHaveValue(`${edited.slice(0, nextCaret)}text ${edited.slice(nextCaret)}`);
  });
}
