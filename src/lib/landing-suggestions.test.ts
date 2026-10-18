import { describe, expect, it } from "vitest";
import { translate, type UiText } from "@/i18n/messages";
import { landingSuggestions, scheduledPromptTemplates } from "@/lib/landing-suggestions";

const english: UiText = (source, values) => translate("en", source, values);
const knownInstallations = ["arnall", "company-qa", "transportexample-demo", "officeexample-production", "retaildemo"];

describe("landing prompt templates", () => {
  it.each(["arnall", "company-qa"])("preserves Arnall scheduling for its explicit %s identity regardless of connectors", (installationId) => {
    expect(landingSuggestions(null, "Arnall", { installationId, gmailAuthorized: true })).toEqual(scheduledPromptTemplates("Arnall"));
    expect(landingSuggestions(null, "Arnall", { installationId })).toEqual(scheduledPromptTemplates("Arnall"));
    const schedule = landingSuggestions(null, "Renamed brand", { installationId })[2];
    expect(schedule.id).toBe("schedule");
    expect(schedule.children).toHaveLength(3);
    expect(schedule.children?.[0].prompt).toContain("revisar los destinatarios y los mensajes antes de enviarlos");
  });

  it.each([...knownInstallations, "other"])("keeps image mode as the override for %s", (installationId) => {
    const suggestions = landingSuggestions(null, "Example", { installationId, imageGeneration: true }, english);
    expect(suggestions.map(item => item.id)).toEqual(["presentation-image", "illustration", "diagram"]);
    expect(suggestions[0].label).toBe("For a presentation");
    expect(suggestions.every(item => !item.children && !item.prompt.includes("Example"))).toBe(true);
  });

});
