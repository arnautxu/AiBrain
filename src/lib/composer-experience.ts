import type { RuntimeReasoningEffort } from "@/lib/runtime-status";

export type ComposerExperience = "fast" | "smart" | "expert";

export type ResolvedComposerExperience = {
  experience: ComposerExperience;
  model: "gpt-5.6-terra" | "gpt-5.6-sol";
  effort: RuntimeReasoningEffort;
};

/** Product intent is stable even when provider model names change. */
export const COMPOSER_EXPERIENCES: Record<ComposerExperience, ResolvedComposerExperience> = {
  fast: { experience: "fast", model: "gpt-5.6-terra", effort: "medium" },
  smart: { experience: "smart", model: "gpt-5.6-sol", effort: "low" },
  expert: { experience: "expert", model: "gpt-5.6-sol", effort: "high" },
};

export function isComposerExperience(value: unknown): value is ComposerExperience {
  return value === "fast" || value === "smart" || value === "expert";
}

export function resolveComposerExperience(experience: ComposerExperience): ResolvedComposerExperience {
  return COMPOSER_EXPERIENCES[experience];
}
