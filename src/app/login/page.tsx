import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import {
  getAuthMode,
  getSession,
  isVercelPreviewDemoEnabled,
} from "@/auth/session";
import { listDemoAccounts } from "@/config/tenants";
import { resolveUiInstallationBranding } from "@/ui/installation-branding";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  const branding = resolveUiInstallationBranding();
  return (
    <LoginForm
      accounts={listDemoAccounts().filter((account) => account.productName === branding.productName)}
      branding={branding}
      mode={getAuthMode()}
      remotePreview={isVercelPreviewDemoEnabled()}
    />
  );
}
