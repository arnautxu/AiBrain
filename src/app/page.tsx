import { BrainApp } from "@/components/brain-app";
import { getSession } from "@/auth/session";
import { loadTenantManifest } from "@/control-plane/manifest-store";
import { loadMemberOnboarding } from "@/onboarding/store";
import { loadWorkbench } from "@/workbench/store";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  let memberOnboarding = null;
  if (session.user.role === "member") {
    memberOnboarding = await loadMemberOnboarding(session);
    if (!memberOnboarding?.completedAt) redirect("/onboarding");
  }
  const manifest = await loadTenantManifest(session.tenant.id);
  if (!manifest) redirect("/login");
  const workbench = await loadWorkbench(session);
  return (
    <BrainApp
      manifest={manifest}
      session={session}
      initialWorkbench={workbench}
      memberPreferences={memberOnboarding ? {
        language: memberOnboarding.preferences.language,
        tone: memberOnboarding.preferences.responseStyle === "concise"
          ? "direct"
          : memberOnboarding.preferences.responseStyle,
      } : null}
    />
  );
}
