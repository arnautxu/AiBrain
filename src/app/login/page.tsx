import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import {
  getAuthMode,
  getSession,
  isVercelPreviewDemoEnabled,
} from "@/auth/session";
import { listDemoAccounts } from "@/config/tenants";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <LoginForm
      accounts={listDemoAccounts()}
      mode={getAuthMode()}
      remotePreview={isVercelPreviewDemoEnabled()}
    />
  );
}
