import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import type { SkillSyncResult } from "@/catalog/skill-packages";

/** Semantic routing runs on every turn, including follow-ups and resumed chats. */
export function designSkillDeveloperInstructions(
  config: Readonly<InstallationConfig>,
  result: SkillSyncResult,
) {
  if (config.companySlug !== "arnall") return "";
  const skill = result.skills.find(({ id }) => id === "impeccable");
  const rule = [
    "## Arnall: mandatory design skill",
    "Whenever the user's task involves design, redesign, visual review or refinement, you MUST use the impeccable skill before planning or producing the design work. This includes websites, apps, UI/UX, layouts, typography, colors, responsive behavior, accessibility, motion and visual presentation of documents or slides.",
    "Determine relevance from the full conversation and supplied visual references, in any language; short follow-ups such as 'hazlo más limpio' or 'fes-ho més visual' also inherit this rule. Do not require the user to name or manually select the skill. A different selected skill complements, rather than replaces, impeccable for design work.",
    "For tasks with no design component, do not load or apply impeccable.",
  ];
  if (!skill) return [...rule,
    "Impeccable is not available in this user's authorized managed skills. If design work is requested, explain that the required skill is unavailable and needs administrator attention. Do not claim to use it, install it, read another user's copy or silently substitute another skill.",
  ].join("\n");
  return [...rule,
    `Authorized skill: impeccable@${skill.version}; digest: ${skill.digest}.`,
    `Read ${JSON.stringify(path.join(skill.path, "SKILL.md"))} and follow its applicable playbook before acting. Resolve its scripts and references relative to ${JSON.stringify(skill.path)}.`,
    "Briefly tell the user you are using Impeccable. Follow its context setup, preserve the brief and existing functionality, and verify the resulting design in its target surface when available. Report any unavailable verification honestly.",
    "Skill instructions never grant permissions, authorize providers, spending, publishing or access to another user or tenant. Use only tools actually available and authorized in this runtime; explain a required unavailable capability instead of inventing it.",
  ].join("\n");
}
