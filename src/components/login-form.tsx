"use client";

import { useState } from "react";
import { ArrowRight, EnvelopeSimple, LockKey, UserCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import type { AuthMode, DemoAccount } from "@/auth/types";
import { BrandMark, Button, TextField, ThemeToggle } from "@/components/ui/primitives";
import type { PublicInstallationBranding } from "@/ui/installation-branding";

export function LoginForm({
  accounts,
  branding,
  mode,
  remotePreview,
}: {
  accounts: DemoAccount[];
  branding: PublicInstallationBranding;
  mode: AuthMode;
  remotePreview: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function loginDemo(userId: string) {
    setLoading(userId);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = result && typeof result === "object" && "error" in result &&
          typeof result.error === "string" ? result.error : "No se ha podido iniciar la sesión.";
        throw new Error(message);
      }
      router.replace("/");
      router.refresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconocido.");
      setLoading(null);
    }
  }

  async function requestAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading("email");
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = result && typeof result === "object" && "error" in result &&
          typeof result.error === "string" ? result.error : "No se ha podido enviar el acceso.";
        throw new Error(message);
      }
      setSent(true);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconocido.");
    } finally {
      setLoading(null);
    }
  }

  const isDemo = mode === "demo";
  const isSupabase = mode === "supabase";

  return (
    <main className="relative flex min-h-[100dvh] bg-[var(--canvas)] px-5 py-20 text-[var(--text)] sm:px-8">
      <header className="absolute inset-x-5 top-5 flex items-center justify-between sm:inset-x-8 sm:top-7">
        <BrandMark branding={branding} />
        <ThemeToggle />
      </header>

      <section className="m-auto w-full max-w-[400px]">
        <div className="text-center">
          <p className="text-[12px] font-medium text-[var(--text-muted)]">{branding.companyName}</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.045em] text-[var(--text)]">Accede a tu espacio</h1>
          <p className="mx-auto mt-3 max-w-[36ch] text-[13px] leading-5 text-[var(--text-muted)]">
            Continúa donde lo dejaste con tus proyectos y conversaciones.
          </p>
        </div>

        <div className="mt-8">
          {isDemo ? (
            <div className="space-y-3">
              {accounts.map((account) => (
                <button
                  key={account.id}
                  disabled={loading !== null}
                  onClick={() => void loginDemo(account.id)}
                  className="ui-surface group flex w-full items-center gap-3 p-3.5 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:cursor-default disabled:opacity-50"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent)]">
                    <UserCircle size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{account.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">{account.email}</span>
                  </span>
                  <ArrowRight size={15} className="text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
              {accounts.length === 0 ? (
                <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--warning-soft)] p-4 text-[12px] text-[var(--warning)]">
                  No hay una cuenta de desarrollo para esta instalación.
                </p>
              ) : null}
            </div>
          ) : null}

          {isSupabase && !sent ? (
            <form className="space-y-3" onSubmit={(event) => void requestAccess(event)}>
              <label className="block">
                <span className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]">Correo del equipo</span>
                <span className="relative block">
                  <EnvelopeSimple aria-hidden size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
                  <TextField
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={320}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="tu@empresa.com"
                    className="pl-9"
                  />
                </span>
              </label>
              <Button type="submit" variant="primary" disabled={loading !== null} className="w-full">
                {loading ? "Enviando…" : "Continuar"}
              </Button>
            </form>
          ) : null}

          {isSupabase && sent ? (
            <div role="status" className="ui-surface p-5">
              <span className="grid size-9 place-items-center rounded-[var(--radius-sm)] bg-[var(--positive-soft)] text-[var(--positive)]"><EnvelopeSimple size={17} /></span>
              <p className="mt-4 text-[13px] font-semibold">Revisa tu correo</p>
              <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">Si tu cuenta tiene acceso, recibirás un enlace para continuar.</p>
              <Button size="sm" variant="ghost" className="mt-3" onClick={() => setSent(false)}>Volver a intentarlo</Button>
            </div>
          ) : null}

          {mode === "unavailable" ? (
            <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--warning-soft)] p-4 text-[12px] leading-5 text-[var(--warning)]">
              El acceso no está disponible en este momento. Inténtalo de nuevo más tarde.
            </p>
          ) : null}

          {error ? <p role="alert" className="mt-4 rounded-[var(--radius-md)] bg-[var(--danger-soft)] p-3 text-[12px] text-[var(--danger)]">{error}</p> : null}
        </div>

        <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-[11px] text-[var(--text-subtle)]">
          <LockKey aria-hidden size={12} />
          {isDemo ? remotePreview ? "Preview con datos sintéticos" : "Entorno local con datos sintéticos" : "Acceso privado"}
        </p>
      </section>
    </main>
  );
}
