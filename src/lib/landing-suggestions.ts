import { isStandaloneProject, type WorkbenchProject } from "@/workbench/types";

export type LandingSuggestion = {
  id: "priorities" | "summary" | "plan" | "gmail" | "presentation-image" | "illustration" | "diagram";
  label: string;
  prompt: string;
};

/** Uses only the selected project and installation name, never inferred email data. */
export function landingSuggestions(
  project: WorkbenchProject | null,
  companyName: string,
  capabilities: { gmailAuthorized?: boolean; imageGeneration?: boolean } = {},
): LandingSuggestion[] {
  if (capabilities.imageGeneration) return [
    { id: "presentation-image", label: "Para una presentación", prompt: "Crea una imagen horizontal para una presentación sobre…" },
    { id: "illustration", label: "Ilustrar una idea", prompt: "Crea una ilustración que represente…" },
    { id: "diagram", label: "Explicar un proceso", prompt: "Crea un diagrama visual que explique estos pasos: …" },
  ];
  if (project && !isStandaloneProject(project)) {
    const projectName = project.name;
    return [
      { id: "priorities", label: "Prioridades", prompt: `Organiza las prioridades de esta semana para ${projectName}.` },
      { id: "summary", label: "Estado del proyecto", prompt: `Resume el estado actual de ${projectName} y señala los próximos pasos.` },
      capabilities.gmailAuthorized
        ? { id: "gmail", label: "Revisar Gmail", prompt: `Revisa en Gmail los correos recientes relacionados con ${projectName} y resume los asuntos que requieren atención.` }
        : { id: "plan", label: "Actualización al equipo", prompt: `Prepara un borrador de actualización para el equipo de ${companyName} sobre ${projectName}.` },
    ];
  }
  return [
    { id: "priorities", label: "Priorizar mi día", prompt: "Ayúdame a priorizar mi trabajo de hoy." },
    { id: "summary", label: "Resumir información", prompt: "Resume la información disponible y señala los próximos pasos." },
    capabilities.gmailAuthorized
      ? { id: "gmail", label: "Revisar Gmail", prompt: "Revisa en Gmail los correos recientes y resume los asuntos que requieren mi atención." }
      : { id: "plan", label: "Preparar un plan", prompt: "Prepara un plan claro para esta tarea." },
  ];
}
