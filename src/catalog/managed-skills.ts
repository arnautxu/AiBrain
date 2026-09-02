import type { InstallationConfig } from "@/config/installation-schema";

export const IMPECCABLE_SKILL = { id: "impeccable", label: "Impeccable · Diseño y UX" };

/** Server-owned defaults also apply to existing Arnall installation configs. */
export function managedSkillsForInstallation(config: Readonly<InstallationConfig>) {
  const configured = config.catalog?.graphikAIManagedSkills ?? [];
  if (config.companySlug !== "arnall" || configured.some(({ id }) => id === IMPECCABLE_SKILL.id)) {
    return configured;
  }
  return [...configured, IMPECCABLE_SKILL];
}
