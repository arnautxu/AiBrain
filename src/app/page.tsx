import { BrainApp } from "@/components/brain-app";
import { getSession } from "@/auth/session";
import { loadInstallationConfig } from "@/config/installation";
import { applyInstallationBranding } from "@/config/installation-branding";
import { getSeedManifest } from "@/config/tenants";
import { baseBrainManifest } from "@/config/brain";
import { loadWorkbench } from "@/workbench/store";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const installation = await loadInstallationConfig();
  const storedManifest = session.provider === "local"
    ? { ...baseBrainManifest, id: `aibrain-${installation.installationId}` }
    : getSeedManifest(session.tenant.id);
  if (!storedManifest) redirect("/login");
  const manifest = applyInstallationBranding(storedManifest, installation);
  const workbench = await loadWorkbench(session);
  return (
    <BrainApp
      manifest={manifest}
      session={session}
      initialWorkbench={workbench}
      logoPath={installation.branding.logoPath}
    />
  );
}
