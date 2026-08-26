import { BrainApp } from "@/components/brain-app";
import { getSession } from "@/auth/session";
import { loadInstallationConfig } from "@/config/installation";
import { applyInstallationBranding } from "@/config/installation-branding";
import { baseBrainManifest } from "@/config/brain";
import { loadTenantManifest } from "@/control-plane/manifest-store";
import { loadMemberOnboarding } from "@/onboarding/store";
import { loadWorkbench } from "@/workbench/store";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const installation = await loadInstallationConfig();
  let memberOnboarding = null;
  if (session.provider !== "local" && session.user.role === "member") {
    memberOnboarding = await loadMemberOnboarding(session);
    if (!memberOnboarding?.completedAt) redirect("/onboarding");
  }
  const storedManifest = session.provider === "local"
    ? { ...baseBrainManifest, id: `aibrain-${installation.installationId}` }
    : await loadTenantManifest(session.tenant.id);
  if (!storedManifest) redirect("/login");
  const manifest = applyInstallationBranding(storedManifest, installation);
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
