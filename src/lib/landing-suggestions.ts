import { spanishUiText, type UiText } from "@/i18n/messages";
import { type WorkbenchProject } from "@/workbench/types";

export type LandingSuggestion = {
  id: "presentation" | "spreadsheets" | "schedule" | "presentation-image" | "illustration" | "diagram" | "store-performance" | "meta-review" | "shopify-review" | "officeexample-crm" | "officeexample-erp" | "officeexample-documents" | "outreach-campaigns" | "outreach-leads" | "outreach-attention" | "document-summary" | "compare-options" | "next-steps" | "automation" | "production" | "quality" | "administration";
  label: string;
  prompt: string;
  iconPath?: string;
  action?: "create-automation";
  children?: { id: string; label: string; prompt: string; disabledReason?: string }[];
};

/** Installation identity selects business templates; display names never select another client’s tasks. */
export function landingSuggestions(
  _project: WorkbenchProject | null,
  companyName: string,
  capabilities: { gmailAuthorized?: boolean; imageGeneration?: boolean; installationId?: string } = {},
  t: UiText = spanishUiText,
): LandingSuggestion[] {
  if (capabilities.imageGeneration) return [
    { id: "presentation-image", label: t("Para una presentación"), prompt: t("Crea una imagen horizontal para una presentación sobre…") },
    { id: "illustration", label: t("Ilustrar una idea"), prompt: t("Crea una ilustración que represente…") },
    { id: "diagram", label: t("Explicar un proceso"), prompt: t("Crea un diagrama visual que explique estos pasos: …") },
  ];
  // Department labels are not an actor permission matrix. WORKSITEA uses the neutral
  // prompts below; its authorized apps remain available through normal navigation.

  if (capabilities.installationId === "arnall" || capabilities.installationId === "company-qa") return scheduledPromptTemplates(companyName, t);
  return [
    { id: "document-summary", label: t("Resumir documentos"), prompt: t("Ayúdame a resumir estos documentos para {company}: … Usa solo el material aportado o autorizado, cita las fuentes y destaca decisiones, dudas y datos que faltan.", { company: companyName }) },
    { id: "compare-options", label: t("Comparar opciones"), prompt: t("Comparemos estas opciones para {company}: … Organiza criterios, ventajas, costes conocidos y dudas con los datos disponibles. Indica qué falta para decidir sin inventar cifras ni compromisos.", { company: companyName }) },
    { id: "next-steps", label: t("Organizar los próximos pasos"), prompt: t("Ayúdame a organizar los próximos pasos de este trabajo de {company}: … A partir de la información aportada, resume pendientes, dependencias y preguntas. Propón responsables y fechas para revisar, sin crear tareas programadas ni enviar mensajes.", { company: companyName }) },
  ];
}

/** Fixed editable prompts, never scheduled jobs or automatic actions. */
export function scheduledPromptTemplates(companyName: string, t: UiText = spanishUiText): LandingSuggestion[] {
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
