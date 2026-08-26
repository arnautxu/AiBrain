import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import {
  getAuthMode,
  getSession,
  isVercelPreviewDemoEnabled,
} from "@/auth/session";
import { loadInstallationConfig } from "@/config/installation";
import { publicInstallationBranding } from "@/config/installation-branding";
import { listDemoAccounts } from "@/config/tenants";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  const installation = await loadInstallationConfig();
  return (
    <LoginForm
      accounts={listDemoAccounts()}
      branding={publicInstallationBranding(installation)}
      mode={getAuthMode()}
      remotePreview={isVercelPreviewDemoEnabled()}
    />
  );
}
