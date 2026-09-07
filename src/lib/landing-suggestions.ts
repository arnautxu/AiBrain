import { type WorkbenchProject } from "@/workbench/types";

export type LandingSuggestion = {
  id: "presentation" | "spreadsheets" | "schedule" | "presentation-image" | "illustration" | "diagram";
  label: string;
  prompt: string;
  iconPath?: string;
  children?: { id: string; label: string; prompt: string }[];
};

/** Uses only the selected project and installation name, never inferred email data. */
export function landingSuggestions(
  _project: WorkbenchProject | null,
  companyName: string,
  capabilities: { gmailAuthorized?: boolean; imageGeneration?: boolean } = {},
  t: (source: string, values?: Record<string, string | number>) => string = (source) => source,
): LandingSuggestion[] {
  if (capabilities.imageGeneration) return [
    { id: "presentation-image", label: t("Para una presentación"), prompt: t("Crea una imagen horizontal para una presentación sobre…") },
    { id: "illustration", label: t("Ilustrar una idea"), prompt: t("Crea una ilustración que represente…") },
    { id: "diagram", label: t("Explicar un proceso"), prompt: t("Crea un diagrama visual que explique estos pasos: …") },
  ];
  return scheduledPromptTemplates(companyName, t);
}

/** Fixed editable prompts, never scheduled jobs or automatic actions. */
export function scheduledPromptTemplates(companyName: string, t: (source: string, values?: Record<string, string | number>) => string = (source, values) => source.replace(/\{company\}/g, String(values?.company ?? ""))): LandingSuggestion[] {
  return [
    { id: "presentation", iconPath: "/branding/microsoft/powerpoint.svg", label: t("Prepárame una presentación"), prompt: t("Prepárame una presentación sobre…") },
    { id: "spreadsheets", iconPath: "/branding/microsoft/excel.svg", label: t("Trabajemos con estos Excels"), prompt: t("Trabajemos con estos Excels. Quiero…") },
    { id: "schedule", iconPath: companyName.trim().toLocaleLowerCase() === "arnall" ? "/branding/arnall/logo.jpg?v=d09bb6bb7e8a" : undefined, label: t("Trabajemos en los horarios del equipo de {company}", { company: companyName }), prompt: "", children: [
      { id: "whatsapp", label: t("Enviar los WhatsApps a los trabajadores"), prompt: t("Preparemos los WhatsApps con los horarios para los trabajadores de {company}. Quiero revisar los destinatarios y los mensajes antes de enviarlos.", { company: companyName }) },
      { id: "prepared", label: t("Dame los horarios preparados"), prompt: t("Dame los horarios preparados del equipo de {company} para…", { company: companyName }) },
      { id: "changes", label: t("Revisar cambios de horarios"), prompt: t("Revisemos los cambios de horarios del equipo de {company} para…", { company: companyName }) },
    ] },
  ];
}
