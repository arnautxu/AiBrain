export type MemberLanguage = "ca" | "es" | "en";
export type MemberResponseStyle = "concise" | "balanced" | "detailed";

export type MemberAssignment = {
  jobTitle: string;
  summary: string;
  responsibilities: string[];
  firstMission: string;
};

export type MemberOnboardingProfile = {
  assignment: MemberAssignment | null;
  preferences: {
    language: MemberLanguage;
    responseStyle: MemberResponseStyle;
  };
  responsibilityFeedback: string;
  completedAt: string | null;
};

export type MemberOnboardingInput = {
  language: MemberLanguage;
  responseStyle: MemberResponseStyle;
  responsibilityFeedback: string;
};

export function isMemberLanguage(value: unknown): value is MemberLanguage {
  return value === "ca" || value === "es" || value === "en";
}

export function isMemberResponseStyle(value: unknown): value is MemberResponseStyle {
  return value === "concise" || value === "balanced" || value === "detailed";
}
