/** Presentation never grants access: callers supply the authorized resource IDs. */
const descriptions: Record<string, string> = {
  gmail: "Busca y lee tus correos.", googlecalendar: "Consulta tus calendarios y eventos.",
  googledrive: "Busca archivos y consulta su información.", outlook: "Consulta tu correo y calendario de Outlook.",
  github: "Consulta repositorios públicos e incidencias.", slack: "Busca conversaciones y mensajes.",
  notion: "Busca páginas y consulta su contenido.", googlesheets: "Consulta hojas de cálculo.",
  googledocs: "Consulta documentos.", linear: "Consulta proyectos e incidencias.",
  airtable: "Consulta tus bases y registros.", hubspot: "Consulta contactos y empresas.",
  jira: "Consulta proyectos e incidencias.", youtube: "Busca vídeos y consulta sus detalles.",
};
export function connectorPresentation(id: string) {
  const slug = id.startsWith("composio-") ? id.slice(9).replaceAll("-", "_") : id;
  return {
    logoUrl: /^[a-z][a-z0-9_]{0,39}$/.test(slug) && (descriptions[slug] || slug === "supabase") ? `/connector-logos/${slug}.svg` : null,
    description: descriptions[slug] ?? "Consulta las fuentes autorizadas de esta app.",
  };
}
