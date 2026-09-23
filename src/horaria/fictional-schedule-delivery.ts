/** A request for an invented Arnall schedule must finish with the template artifact. */
export function requiresFictionalScheduleArtifact(companySlug: string | undefined, message: string): boolean {
  if (companySlug !== "arnall") return false;
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase();
  return /\b(?:horari|horario|schedule|quadrant|cuadrante)s?\b/u.test(normalized) &&
    /\b(?:fictici(?:a|es|s)?|ficticio(?:s)?|fictitious|inventad[oa]s?|simulacio|simulacion|demo)\b/u.test(normalized) &&
    /\b(?:fes|feu|haz|haced|genera(?:r|d)?|crea(?:r|d)?|prepara(?:r|d)?|mostra|muestra|create|generate|prepare)\b/u.test(normalized);
}
