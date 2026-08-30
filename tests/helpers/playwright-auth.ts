import { expect, type Page } from "@playwright/test";

const DEMO_SESSION_COOKIE = "aibrain_demo_session";

export async function establishDemoSession(page: Page, userId: string) {
  await page.goto("/api/auth/session");
  const origin = new URL(page.url()).origin;
  const loginResponse = await page.context().request.post(`${origin}/api/auth/login`, {
    data: { userId },
    headers: { Origin: origin },
  });
  expect(loginResponse.ok()).toBe(true);

  await expect.poll(async () => {
    const cookies = await page.context().cookies(origin);
    if (!cookies.some((cookie) => cookie.name === DEMO_SESSION_COOKIE && cookie.value)) return null;
    const sessionResponse = await page.context().request.get(`${origin}/api/auth/session`, {
      headers: { Origin: origin },
    });
    if (!sessionResponse.ok()) return null;
    const payload: unknown = await sessionResponse.json().catch(() => null);
    return payload && typeof payload === "object" && "session" in payload &&
      payload.session && typeof payload.session === "object" && "user" in payload.session &&
      payload.session.user && typeof payload.session.user === "object" && "id" in payload.session.user &&
      typeof payload.session.user.id === "string"
      ? payload.session.user.id
      : null;
  }, { message: `demo session for ${userId} must be readable before navigation` }).toBe(userId);

  await page.goto("/");
  await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("composer")).toBeVisible();
}

export async function submitPrompt(page: Page, prompt: string) {
  const composer = page.getByRole("textbox", { name: "Mensaje" });
  const submit = page.getByRole("button", { name: "Enviar mensaje" });
  await composer.fill(prompt);
  await expect(composer).toHaveValue(prompt);
  await expect(submit).toBeEnabled();
  await submit.click();
}
