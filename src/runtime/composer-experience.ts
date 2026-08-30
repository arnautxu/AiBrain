import "server-only";
import type { ComposerExperience } from "@/lib/composer-experience";
import type { RuntimeReasoningEffort } from "@/lib/runtime-status";

export type ResolvedComposerExperience = {
  model: "gpt-5.6-terra" | "gpt-5.6-sol";
  effort: RuntimeReasoningEffort;
};

const SERVER_COMPOSER_EXPERIENCES: Record<ComposerExperience, ResolvedComposerExperience> = {
  fast: { model: "gpt-5.6-terra", effort: "low" },
  smart: { model: "gpt-5.6-sol", effort: "low" },
  expert: { model: "gpt-5.6-sol", effort: "high" },
};

export function resolveServerComposerExperience(
  experience: ComposerExperience,
): ResolvedComposerExperience {
  return SERVER_COMPOSER_EXPERIENCES[experience];
}
