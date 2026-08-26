import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { ControlPlaneForm } from "@/components/control-plane-form";
import { loadManifestEditorData } from "@/control-plane/manifest-store";

export const dynamic = "force-dynamic";

export default async function ControlPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.role !== "owner") redirect("/?control=forbidden");
  const manifest = await loadManifestEditorData(session.tenant.id);
  if (!manifest) redirect("/");
  return <ControlPlaneForm initial={manifest} session={session} />;
}
