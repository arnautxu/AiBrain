/** A request for an invented Arnall schedule must finish with the template artifact. */
export function requiresFictionalScheduleArtifact(companySlug: string | undefined, message: string): boolean {
  if (companySlug !== "arnall") return false;
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase();
  const fiction = /\b(?:fictici(?:a|es|s)?|ficticio(?:s)?|fictitious|inventad[oa]s?|simulacio|simulacion|demo)\b/gu;
  const requestedSimulation = [...normalized.matchAll(fiction)].some((match) => {
    const preceding = normalized.slice(0, match.index).split(/[.!?;,\n]/u).at(-1) ?? "";
    // "No amplíes mínimos ficticios" or "sense dades fictícies" describes a
    // real-data boundary, not a request to create an invented schedule.
    return !/\b(?:no|sin|sense|mai|nunca|never|without|not)\b[^.!?;,\n]*$/u.test(preceding);
  });
  return /\b(?:horari|horario|schedule|quadrant|cuadrante)s?\b/u.test(normalized) &&
    requestedSimulation &&
    /\b(?:fes|feu|haz|haced|genera(?:r|d)?|crea(?:r|d)?|prepara(?:r|d)?|mostra|muestra|create|generate|prepare)\b/u.test(normalized);
}
