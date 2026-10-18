import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";

import { BrainApp } from "@/components/brain-app";
import { baseBrainManifest } from "@/config/brain";
import { loadInstallationConfig } from "@/config/installation";
import {
  applyInstallationBranding,
  publicInstallationBranding,
} from "@/config/installation-branding";
import { getSeedManifest } from "@/config/tenants";
import { loadWorkbench } from "@/workbench/store";
import { installationUiLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ settings?: string }> }) {
  const { settings } = await searchParams;
  const loginPath = settings === "connectors" || settings === "memory" ? `/login?settings=${settings}` : "/login";
  const session = await getSession();
  if (!session) redirect(loginPath);

  const installation = await loadInstallationConfig();
  const storedManifest = session.provider === "local"
    ? { ...baseBrainManifest, id: `aibrain-${installation.installationId}` }
    : getSeedManifest(session.tenant.id);
  if (!storedManifest) redirect("/login");

  const locale = await installationUiLocale();
  const manifest = applyInstallationBranding({
    ...storedManifest,
    identity: { ...storedManifest.identity, language: locale },
  }, installation);
  const branding = publicInstallationBranding(installation);
  const workbench = await loadWorkbench(session);

  return (
    <BrainApp
      branding={branding}
      manifest={manifest}
      session={session}
      initialWorkbench={workbench}

    />
  );
}
