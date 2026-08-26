import "server-only";

import { cookies } from "next/headers";
import type { AuthSession } from "@/auth/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  MemberAssignment,
  MemberOnboardingInput,
  MemberOnboardingProfile,
  MemberResponseStyle,
  MemberLanguage,
} from "@/onboarding/types";

const DEMO_ONBOARDING_COOKIE = "aibrain_member_onboarding_v2";

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asResponsibilities(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim())
    .slice(0, 8);
}

function asLanguage(value: unknown): MemberLanguage {
  return value === "es" || value === "en" ? value : "ca";
}

function asResponseStyle(value: unknown): MemberResponseStyle {
  return value === "concise" || value === "detailed" ? value : "balanced";
}

function assignmentFromRow(row: Record<string, unknown>): MemberAssignment | null {
  const jobTitle = asText(row.job_title);
  const summary = asText(row.role_summary);
  const responsibilities = asResponsibilities(row.responsibilities);
  const firstMission = asText(row.first_mission);
  if (!jobTitle || !summary || !responsibilities.length || !firstMission) return null;
  return { jobTitle, summary, responsibilities, firstMission };
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

  const supabase = await createSupabaseServerClient();
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", session.tenant.id)
    .maybeSingle();
  if (tenantError || !tenant || typeof tenant.id !== "number") {
    throw new Error("No s’ha pogut resoldre el tenant de l’onboarding.");
  }

  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("job_title, role_summary, responsibilities, first_mission, preferred_language, response_style, responsibility_feedback, onboarding_completed_at")
    .eq("tenant_id", tenant.id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error || !data) {
    throw new Error("No s’ha pogut carregar l’onboarding del membre.");
  }

  const row = data as Record<string, unknown>;
  return {
    assignment: assignmentFromRow(row),
    preferences: {
      language: asLanguage(row.preferred_language),
      responseStyle: asResponseStyle(row.response_style),
    },
    responsibilityFeedback: asText(row.responsibility_feedback) ?? "",
    completedAt: asText(row.onboarding_completed_at),
  };
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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("complete_member_onboarding", {
    p_tenant_slug: session.tenant.id,
    p_preferred_language: input.language,
    p_response_style: input.responseStyle,
    p_responsibility_feedback: input.responsibilityFeedback,
  });
  if (error) {
    console.error("AiBrain member onboarding failed", { code: error.code });
    return false;
  }
  return data === true;
}
