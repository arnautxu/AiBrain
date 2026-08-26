import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { MemberOnboarding } from "@/components/member-onboarding";
import { loadTenantManifest } from "@/control-plane/manifest-store";
import { loadMemberOnboarding } from "@/onboarding/store";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.role !== "member") redirect("/");

  const [profile, manifest] = await Promise.all([
    loadMemberOnboarding(session),
    loadTenantManifest(session.tenant.id),
  ]);
  if (!profile || profile.completedAt) redirect("/");
  if (!manifest) redirect("/login");

  const capabilities = [
    manifest.composer.webSearch ? "Cerca web" : null,
    manifest.composer.images ? "Analitzar imatges" : null,
    manifest.composer.imageGeneration ? "Generar imatges" : null,
    manifest.composer.skills ? "Skills de l’empresa" : null,
    manifest.behavior.conversationMemory ? "Memòria de conversa" : null,
    manifest.interface.showInspector ? "Revisió i traça" : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <MemberOnboarding
      profile={profile}
      capabilities={capabilities}
      memberName={session.user.name}
      tenantName={session.tenant.name}
      assistantName={manifest.identity.assistantName}
    />
  );
}
