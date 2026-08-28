"use client";

import { useState } from "react";
import {
  ArrowRight,
  EnvelopeSimple,
  LockKey,
  UserCircle,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import type { AuthMode, DemoAccount } from "@/auth/types";
import { BrandMark, Button, TextField, ThemeToggle } from "@/components/ui/primitives";
import type { PublicInstallationBranding } from "@/config/installation-branding";

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
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [recovering, setRecovering] = useState(false);
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
        throw new Error(
          result && typeof result === "object" && "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "No se ha podido iniciar la sesión.",
        );
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
    setLoading("login");
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          result && typeof result === "object" && "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "No se ha podido iniciar la sesión.",
        );
      }
      if (
        result &&
        typeof result === "object" &&
        "passwordChangeRequired" in result &&
        result.passwordChangeRequired === true
      ) {
        setPassword("");
        setConfirmation("");
        setPasswordChangeRequired(true);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconocido.");
    } finally {
      setLoading(null);
    }
  }

  function returnToLogin() {
    setPasswordChangeRequired(false);
    setPassword("");
    setConfirmation("");
    setError(null);
  }

  async function changeInitialPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading("password-change");
    setError(null);
    try {
      const response = await fetch("/api/auth/password/change-initial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          result && typeof result === "object" && "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "No se ha podido cambiar la contraseña.",
        );
      }
      router.replace("/");
      router.refresh();
    } catch (currentError) {
      const message = currentError instanceof Error ? currentError.message : "Error desconocido.";
      if (message === "El canvi de contrasenya ha caducat.") {
        returnToLogin();
        setError("El canvi de contrasenya ha caducat. Torna a iniciar sessió per continuar.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(null);
    }
  }

  async function requestRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading("recovery");
    setError(null);
    try {
      const response = await fetch("/api/auth/password/reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        throw new Error("No se ha podido solicitar la recuperación.");
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
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.045em] text-[var(--text)]">
            {passwordChangeRequired ? "Protege tu cuenta" : recovering ? "Recupera el acceso" : "Accede a tu espacio"}
          </h1>
          <p className="mx-auto mt-3 max-w-[38ch] text-[13px] leading-5 text-[var(--text-muted)]">
            {passwordChangeRequired
              ? "Crea una contraseña propia antes de entrar por primera vez."
              : recovering
                ? "Te enviaremos instrucciones sin revelar si la cuenta existe."
                : "Continúa donde lo dejaste con tus proyectos y conversaciones."}
          </p>
        </div>

        <div className="mt-8">
          {isDemo ? (
            <div className="space-y-3">
              {accounts.map((account) => (
                <button
                  type="button"
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

          {isSupabase && !sent && !passwordChangeRequired ? (
            <form className="space-y-3" onSubmit={(event) => void (recovering ? requestRecovery(event) : requestAccess(event))}>
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

              {!recovering ? (
                <label className="block">
                  <span className="mb-2 block text-[12px] font-medium text-[var(--text-muted)]">Contraseña</span>
                  <span className="relative block">
                    <LockKey aria-hidden size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
                    <TextField
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={4096}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="pl-9"
                    />
                  </span>
                </label>
              ) : null}

              <Button type="submit" variant="primary" disabled={loading !== null} className="w-full">
                {loading ? "Validando…" : recovering ? "Enviar recuperación" : "Entrar"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setRecovering((current) => !current);
                  setError(null);
                }}
              >
                {recovering ? "Volver al inicio de sesión" : "He olvidado la contraseña"}
              </Button>
            </form>
          ) : null}

          {isSupabase && passwordChangeRequired ? (
            <form className="space-y-3" onSubmit={(event) => void changeInitialPassword(event)}>
              <TextField
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Contraseña nueva"
              />
              <TextField
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="Repite la contraseña"
              />
              <p className="text-[11px] leading-5 text-[var(--text-muted)]">Entre 12 y 128 caracteres, con al menos una letra y un número.</p>
              <Button type="submit" variant="primary" disabled={loading !== null} className="w-full">
                {loading ? "Actualizando…" : "Actualizar y entrar"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={loading !== null}
                className="w-full"
                onClick={returnToLogin}
              >
                Volver al inicio de sesión
              </Button>
            </form>
          ) : null}

          {isSupabase && sent ? (
            <div role="status" className="ui-surface p-5">
              <span className="grid size-9 place-items-center rounded-[var(--radius-sm)] bg-[var(--positive-soft)] text-[var(--positive)]"><EnvelopeSimple size={17} /></span>
              <p className="mt-4 text-[13px] font-semibold">Revisa tu correo</p>
              <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">Si la cuenta existe, recibirás instrucciones para crear una contraseña nueva.</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-3"
                onClick={() => {
                  setSent(false);
                  setRecovering(false);
                }}
              >
                Volver al inicio
              </Button>
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
          {isDemo
            ? remotePreview ? "Preview con datos sintéticos" : "Entorno local con datos sintéticos"
            : "Acceso privado · sesión local opaca"}
        </p>
      </section>
    </main>
  );
}
