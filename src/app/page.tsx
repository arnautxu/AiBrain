import { BrainApp } from "@/components/brain-app";
import { getSession } from "@/auth/session";
import { loadTenantManifest } from "@/control-plane/manifest-store";
import { loadWorkbench } from "@/workbench/store";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const manifest = await loadTenantManifest(session.tenant.id);
  if (!manifest) redirect("/login");
  const workbench = await loadWorkbench(session);
  return <BrainApp manifest={manifest} session={session} initialWorkbench={workbench} />;
}
