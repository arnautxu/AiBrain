import "server-only";

import { cookies } from "next/headers";
import type { AuthSession } from "@/auth/types";
import type {
  MemberOnboardingInput,
  MemberOnboardingProfile,
  MemberResponseStyle,
  MemberLanguage,
} from "@/onboarding/types";

const DEMO_ONBOARDING_COOKIE = "aibrain_member_onboarding_v2";

function asLanguage(value: unknown): MemberLanguage {
  return value === "es" || value === "en" ? value : "ca";
}

function asResponseStyle(value: unknown): MemberResponseStyle {
  return value === "concise" || value === "detailed" ? value : "balanced";
}

function demoProfile(): MemberOnboardingProfile {
  return {
    assignment: {
      jobTitle: "Coordinació d’operacions",
      summary: "Coordines incidències, automatitzacions i seguiment operatiu de l’equip.",
      responsibilities: [
        "Prioritzar incidències i bloquejos",
        "Preparar seguiments operatius",
        "Documentar decisions i pròxims passos",
      ],
      firstMission: "Revisa les prioritats operatives d’avui i proposa els tres pròxims passos.",
    },
    preferences: { language: "ca", responseStyle: "balanced" },
    responsibilityFeedback: "",
    completedAt: null,
  };
}

async function loadDemoProfile(session: AuthSession) {
  const profile = demoProfile();
  const stored = (await cookies()).get(DEMO_ONBOARDING_COOKIE)?.value.split(":") ?? [];
  const completed = stored[0] === session.user.id && stored[1] === session.tenant.id;
  return {
    ...profile,
    preferences: completed ? {
      language: asLanguage(stored[2]),
      responseStyle: asResponseStyle(stored[3]),
    } : profile.preferences,
    completedAt: completed ? new Date(0).toISOString() : null,
  };
}

export async function loadMemberOnboarding(
  session: AuthSession,
): Promise<MemberOnboardingProfile | null> {
  if (session.user.role !== "member") return null;
  if (session.provider === "demo") return loadDemoProfile(session);
  // Local employee onboarding is provisioned through PROFILE.md and
  // PREFERENCES.md. The current local shell skips this legacy UI flow.
  return null;
}

export async function completeMemberOnboarding(
  session: AuthSession,
  input: MemberOnboardingInput,
) {
  if (session.user.role !== "member") return false;
  if (session.provider === "demo") {
    (await cookies()).set(
      DEMO_ONBOARDING_COOKIE,
      `${session.user.id}:${session.tenant.id}:${input.language}:${input.responseStyle}`,
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      },
    );
    return true;
  }

  return false;
}
