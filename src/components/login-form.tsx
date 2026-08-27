"use client";

import { useState } from "react";
import {
  ArrowRight,
  EnvelopeSimple,
  LockKey,
  PaperPlaneTilt,
  UsersThree,
} from "@phosphor-icons/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { AuthMode, DemoAccount } from "@/auth/types";
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
        const message = result && typeof result === "object" && "error" in result &&
          typeof result.error === "string" ? result.error : "No s’ha pogut iniciar la sessió.";
        throw new Error(message);
      }
      router.replace("/");
      router.refresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconegut.");
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
        body: JSON.stringify({ email, password }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = result && typeof result === "object" && "error" in result &&
          typeof result.error === "string" ? result.error : "No s’ha pogut iniciar la sessió.";
        throw new Error(message);
      }
      if (result && typeof result === "object" && "passwordChangeRequired" in result &&
        result.passwordChangeRequired === true) {
        setPassword("");
        setPasswordChangeRequired(true);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconegut.");
    } finally {
      setLoading(null);
    }
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
        throw new Error(result && typeof result === "object" && "error" in result &&
          typeof result.error === "string" ? result.error : "No s’ha pogut canviar la contrasenya.");
      }
      router.replace("/");
      router.refresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconegut.");
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
      if (!response.ok) throw new Error("No s’ha pogut sol·licitar la recuperació.");
      setSent(true);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconegut.");
    } finally {
      setLoading(null);
    }
  }

  const isDemo = mode === "demo";
  const isSupabase = mode === "supabase";

  return (
    <main className="min-h-[100dvh] bg-[#f2f3f0] px-5 py-8 text-[#252522] md:grid md:place-items-center md:px-8">
      <section className="mx-auto w-full max-w-[920px] overflow-hidden rounded-[26px] border border-[#ddded9] bg-[#fbfbfa] shadow-[0_32px_90px_-56px_rgba(30,34,29,.55)] md:grid md:grid-cols-[.82fr_1.18fr]">
        <div className="flex min-h-[320px] flex-col justify-between bg-[#20221f] p-7 text-white md:min-h-[600px] md:p-9">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center overflow-hidden rounded-[10px] bg-white text-[#20221f]">
                <Image
                  src={branding.logoPath}
                  alt=""
                  width={32}
                  height={32}
                  unoptimized
                  className="size-full object-cover"
                />
              </span>
              <span className="text-[13px] font-semibold tracking-[-.02em]">{branding.productName}</span>
            </div>
            <p className="mt-16 max-w-[13ch] text-[34px] font-semibold leading-[1.02] tracking-[-.055em] md:mt-24 md:text-[46px]">
              El Company Brain privat de {branding.companyName}.
            </p>
          </div>
          <div className="mt-14 border-t border-white/12 pt-5">
            <div className="flex items-center gap-2 text-[10px] font-medium text-white/60">
              <LockKey size={13} /> {isDemo ? remotePreview ? "Preview signada · tenant demo verificat" : "Sessió signada · tenant verificat al servidor" : isSupabase ? "Identitat externa · sessió local opaca" : "Accés bloquejat · configuració incompleta"}
            </div>
            <p className="mt-3 max-w-[34ch] text-[10px] leading-5 text-white/42">
              {isDemo
                ? remotePreview
                  ? "Aquesta URL ensenya la UX actual amb dades simulades; no executa Codex ni desa dades de producció."
                  : "Aquesta entrada valida arquitectura, rols i aïllament sense crear comptes externs."
                : isSupabase
                  ? "Supabase només verifica la identitat. Després, una sessió local aïllada manté el workbench disponible."
                  : "No s’emetrà cap sessió fins que el proveïdor d’identitat tingui una configuració completa."}
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-center p-6 sm:p-10 md:p-12">
          <div className="mb-8">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dfdeda] bg-white px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.11em] text-[#76736d]">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: isSupabase ? branding.accentColor : "#d39b3f" }} />
              {isDemo ? remotePreview ? "Preview UX remota" : "Entorn demo local" : isSupabase ? "Accés privat" : "Configuració pendent"}
            </span>
            <h1 className="mt-5 text-[29px] font-semibold tracking-[-.045em] text-[#292825]">
              {isDemo ? "Tria una experiència" : "Entra al teu workbench"}
            </h1>
            <p className="mt-2 max-w-[48ch] text-[11px] leading-5 text-[#77746e]">
              {isDemo
                ? "Les dues identitats carreguen manifests, finestres, preferències i workspaces diferents."
                : isSupabase
                  ? "Entra amb les credencials assignades a la teva instal·lació."
                  : "Configura Supabase Auth per verificar la identitat i emetre sessions locals."}
            </p>
          </div>

          {isDemo ? (
            <div className="space-y-3">
              {accounts.map((account) => (
                <button
                  key={account.id}
                  disabled={loading !== null}
                  onClick={() => void loginDemo(account.id)}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-[#dfded9] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#bdbab3] hover:shadow-[0_16px_30px_-24px_rgba(0,0,0,.45)] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#efefec] text-[#56534e]"><UsersThree size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[#34322f]">{account.productName}</span>
                    <span className="mt-1 block truncate text-[9px] text-[#8a8781]">{account.name} · {account.tenantName}</span>
                    <span className="mt-1.5 block text-[9px] leading-4 text-[#aaa7a1]">{account.description}</span>
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-[#aaa7a1] transition group-hover:translate-x-0.5 group-hover:text-[#504d48]" />
                </button>
              ))}
            </div>
          ) : null}

          {isSupabase && !sent && !passwordChangeRequired ? (
            <form className="space-y-4" onSubmit={(event) => void (recovering ? requestRecovery(event) : requestAccess(event))}>
              <label className="block">
                <span className="mb-2 block text-[9px] font-semibold text-[#77746e]">Correu de l’equip</span>
                <span className="flex items-center gap-2.5 rounded-xl border border-[#d9d7d2] bg-white px-3.5 focus-within:border-[#aaa7a1]">
                  <EnvelopeSimple size={15} className="shrink-0 text-[#918e88]" />
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={320}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="tu@empresa.cat"
                    className="min-w-0 flex-1 bg-transparent py-3 text-[11px] outline-none placeholder:text-[#bbb8b2]"
                  />
                </span>
              </label>
              {!recovering ? (
                <label className="block">
                  <span className="mb-2 block text-[9px] font-semibold text-[#77746e]">Contrasenya</span>
                  <span className="flex items-center gap-2.5 rounded-xl border border-[#d9d7d2] bg-white px-3.5 focus-within:border-[#aaa7a1]">
                    <LockKey size={15} className="shrink-0 text-[#918e88]" />
                    <input type="password" autoComplete="current-password" required maxLength={4096} value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-[11px] outline-none" />
                  </span>
                </label>
              ) : null}
              <button disabled={loading !== null} style={{ backgroundColor: branding.accentColor }} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[10px] font-semibold text-white disabled:opacity-55">
                <PaperPlaneTilt size={14} /> {loading ? "Validant…" : recovering ? "Envia l’enllaç de recuperació" : "Entra"}
              </button>
              <button type="button" onClick={() => { setRecovering(!recovering); setError(null); }} className="w-full text-[9px] font-semibold text-[#77746e] underline underline-offset-4">
                {recovering ? "Torna a l’inici de sessió" : "He oblidat la contrasenya"}
              </button>
            </form>
          ) : null}

          {isSupabase && passwordChangeRequired ? (
            <form className="space-y-4" onSubmit={(event) => void changeInitialPassword(event)}>
              <p className="text-[10px] leading-5 text-[#77746e]">Per seguretat, crea una contrasenya pròpia abans d’entrar.</p>
              <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contrasenya nova" className="w-full rounded-xl border border-[#d9d7d2] bg-white px-3.5 py-3 text-[11px] outline-none" />
              <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repeteix la contrasenya" className="w-full rounded-xl border border-[#d9d7d2] bg-white px-3.5 py-3 text-[11px] outline-none" />
              <button disabled={loading !== null} style={{ backgroundColor: branding.accentColor }} className="w-full rounded-xl px-4 py-3 text-[10px] font-semibold text-white disabled:opacity-55">{loading ? "Actualitzant…" : "Actualitza i entra"}</button>
            </form>
          ) : null}

          {isSupabase && sent ? (
            <div role="status" className="rounded-2xl border border-[#d9e5da] bg-[#f2f8f3] p-5">
              <span className="grid size-9 place-items-center rounded-xl bg-white text-[#4f7d5a]"><EnvelopeSimple size={17} /></span>
              <p className="mt-4 text-[12px] font-semibold text-[#354b3a]">Revisa el correu</p>
              <p className="mt-2 text-[10px] leading-5 text-[#65786a]">Si el compte existeix, rebràs un enllaç per crear una contrasenya nova.</p>
              <button type="button" onClick={() => { setSent(false); setRecovering(false); }} className="mt-4 text-[9px] font-semibold text-[#52695a] underline underline-offset-4">Torna a l’inici</button>
            </div>
          ) : null}

          {mode === "unavailable" ? (
            <p role="alert" className="rounded-xl bg-[#fff4df] px-4 py-3 text-[10px] leading-5 text-[#805f27]">
              Falta configurar el proveïdor d’identitat. L’aplicació queda tancada per seguretat.
            </p>
          ) : null}

          {loading ? <p className="mt-4 text-[10px] text-[#74716b]">Preparant el tenant…</p> : null}
          {error ? <p role="alert" className="mt-4 rounded-lg bg-[#fff3ee] px-3 py-2 text-[10px] text-[#8b4e39]">{error}</p> : null}
          <p className="mt-7 text-[9px] leading-4 text-[#aaa7a1]">
            {isDemo ? remotePreview ? "Preview efímera i aïllada; no és un entorn de producció." : "Mode exclusiu de desenvolupament; no accepta credencials arbitràries." : "Sense alta pública. L’accés es provisiona al servidor de la instal·lació."}
          </p>
        </div>
      </section>
    </main>
  );
}
