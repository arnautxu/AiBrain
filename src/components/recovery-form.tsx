"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { BrandMark, ThemeToggle } from "@/components/ui/primitives";
import { customAccentTokens } from "@/config/brain";
import type { PublicInstallationBranding } from "@/config/installation-branding";

type RecoveryStyle = CSSProperties & {
  "--brain-accent-light": string;
  "--brain-accent-dark": string;
  "--brain-accent-on-soft-light": string;
  "--brain-accent-on-soft-dark": string;
  "--brain-contrast-light": string;
  "--brain-contrast-dark": string;
};

export function RecoveryForm({
  branding,
  proof,
}: {
  branding: PublicInstallationBranding;
  proof: { code: string } | { tokenHash: string } | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const style = useMemo<RecoveryStyle>(() => {
    const accent = customAccentTokens(branding.accentColor) ?? customAccentTokens("#315ee7")!;
    return {
      "--brain-accent-light": accent.onLight,
      "--brain-accent-dark": accent.onDark,
      "--brain-accent-on-soft-light": accent.onLightSoft,
      "--brain-accent-on-soft-dark": accent.onDarkSoft,
      "--brain-contrast-light": accent.onLightContrast,
      "--brain-contrast-dark": accent.onDarkContrast,
    };
  }, [branding.accentColor]);

  useEffect(() => {
    window.history.replaceState(null, "", "/auth/recovery");
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proof) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/password/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...proof, password, confirmation }),
      });
      if (!response.ok) {
        setError(response.status === 410
          ? "El enlace de recuperación ha caducado. Solicita uno nuevo."
          : "No se ha podido actualizar la contraseña. Revisa los datos e inténtalo de nuevo.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("No se ha podido conectar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={style} className="auth-brand-surface relative grid min-h-[100dvh] place-items-center bg-[var(--canvas)] px-5 py-20 text-[var(--text)]">
      <header className="absolute inset-x-5 top-[max(1.25rem,env(safe-area-inset-top))] flex items-center justify-between sm:inset-x-8 sm:top-7">
        <BrandMark branding={branding} />
        <ThemeToggle />
      </header>
      <section className="w-full max-w-md rounded-[26px] border border-[var(--border)] bg-[var(--surface-raised)] p-8 shadow-[var(--shadow-lg)]">
        <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--text-subtle)]">{branding.productName}</p>
        <h1 className="mt-4 text-[28px] font-semibold tracking-[-.045em]">Crea una contraseña nueva</h1>
        {!proof ? (
          <div className="mt-5 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[12px] text-[var(--danger)]"><p role="alert">El enlace de recuperación no es válido o ha caducado.</p><Link href="/login" className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-current px-3 font-semibold">Volver al acceso</Link></div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4" aria-busy={loading}>
            <label className="block" htmlFor="recovery-password">
              <span className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]">Contraseña nueva</span>
              <input autoFocus id="recovery-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="recovery-password-requirements" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-[14px] text-[var(--text)] outline-none focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--brain-accent-soft)]" />
            </label>
            <label className="block" htmlFor="recovery-password-confirmation">
              <span className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]">Repite la contraseña</span>
              <input id="recovery-password-confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-describedby="recovery-password-requirements" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-[14px] text-[var(--text)] outline-none focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--brain-accent-soft)]" />
            </label>
            <p id="recovery-password-requirements" className="text-[11px] leading-4 text-[var(--text-subtle)]">Entre 12 y 128 caracteres.</p>
            <button disabled={loading} className="min-h-11 w-full rounded-xl bg-[var(--brain-accent)] px-4 py-3 text-[12px] font-semibold text-[var(--brain-contrast)] disabled:opacity-55">{loading ? "Actualizando…" : "Actualizar y entrar"}</button>
          </form>
        )}
        {error ? <p role="alert" className="mt-4 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[12px] text-[var(--danger)]">{error}</p> : null}
      </section>
    </main>
  );
}
