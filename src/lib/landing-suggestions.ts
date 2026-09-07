import { type WorkbenchProject } from "@/workbench/types";

export type LandingSuggestion = {
  id: "presentation" | "spreadsheets" | "schedule" | "presentation-image" | "illustration" | "diagram";
  label: string;
  prompt: string;
  children?: { id: string; label: string; prompt: string }[];
};

/** Uses only the selected project and installation name, never inferred email data. */
export function landingSuggestions(
  _project: WorkbenchProject | null,
  companyName: string,
  capabilities: { gmailAuthorized?: boolean; imageGeneration?: boolean } = {},
): LandingSuggestion[] {
  if (capabilities.imageGeneration) return [
    { id: "presentation-image", label: "Para una presentación", prompt: "Crea una imagen horizontal para una presentación sobre…" },
    { id: "illustration", label: "Ilustrar una idea", prompt: "Crea una ilustración que represente…" },
    { id: "diagram", label: "Explicar un proceso", prompt: "Crea un diagrama visual que explique estos pasos: …" },
  ];
  return scheduledPromptTemplates(companyName);
}

/** Fixed editable prompts, never scheduled jobs or automatic actions. */
export function scheduledPromptTemplates(companyName: string): LandingSuggestion[] {
  return [
    { id: "presentation", label: "Prepárame una presentación", prompt: "Prepárame una presentación sobre…" },
    { id: "spreadsheets", label: "Trabajemos con estos Excels", prompt: "Trabajemos con estos Excels. Quiero…" },
    { id: "schedule", label: `Trabajemos en los horarios del equipo de ${companyName}`, prompt: "", children: [
      { id: "whatsapp", label: "Enviar los WhatsApps a los trabajadores", prompt: `Preparemos los WhatsApps con los horarios para los trabajadores de ${companyName}. Quiero revisar los destinatarios y los mensajes antes de enviarlos.` },
      { id: "prepared", label: "Dame los horarios preparados", prompt: `Dame los horarios preparados del equipo de ${companyName} para…` },
      { id: "changes", label: "Revisar cambios de horarios", prompt: `Revisemos los cambios de horarios del equipo de ${companyName} para…` },
    ] },
  ];
}
