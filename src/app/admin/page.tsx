import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminCenter } from "@/components/admin-center";
import { isWorkspaceAdmin } from "@/admin/server-service";
import { getSession } from "@/auth/session";
import { loadInstallationConfig } from "@/config/installation";

export const dynamic = "force-dynamic";

/** A separate, server-authorized administration surface. */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!await isWorkspaceAdmin(session)) notFound();
  const installation = await loadInstallationConfig();

  return <main className="min-h-dvh bg-[var(--canvas)] px-4 py-6 text-[var(--text)] md:px-8 md:py-10"><div className="mx-auto max-w-5xl"><header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-5"><div><p className="text-[11px] font-medium text-[var(--text-subtle)]">{installation.branding.productName}</p><h1 className="mt-1 text-[24px] font-semibold tracking-[-.03em]">Administración del espacio de trabajo</h1></div><Link href="/" className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Volver al trabajo</Link></header><AdminCenter /></div></main>;
}
