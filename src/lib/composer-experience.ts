export type ComposerExperience = "fast" | "smart" | "expert";

export function isComposerExperience(value: unknown): value is ComposerExperience {
  return value === "fast" || value === "smart" || value === "expert";
}
