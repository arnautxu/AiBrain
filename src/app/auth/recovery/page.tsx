import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { RecoveryForm } from "@/components/recovery-form";
import { loadInstallationConfig } from "@/config/installation";
import { publicInstallationBranding } from "@/config/installation-branding";

export const dynamic = "force-dynamic";

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getSession()) redirect("/");
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : undefined;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : undefined;
  const installation = await loadInstallationConfig();
  return (
    <RecoveryForm
      branding={publicInstallationBranding(installation)}
      proof={code ? { code } : tokenHash ? { tokenHash } : null}
    />
  );
}
