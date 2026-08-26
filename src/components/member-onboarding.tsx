"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  CheckCircle,
  Flag,
  LockKey,
  RocketLaunch,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import type {
  MemberLanguage,
  MemberOnboardingProfile,
  MemberResponseStyle,
} from "@/onboarding/types";

const languageOptions: Array<{ value: MemberLanguage; label: string }> = [
  { value: "ca", label: "Català" },
  { value: "es", label: "Castellà" },
  { value: "en", label: "English" },
];

const responseOptions: Array<{
  value: MemberResponseStyle;
  label: string;
  detail: string;
}> = [
  { value: "concise", label: "Breu", detail: "Respostes directes i accionables" },
  { value: "balanced", label: "Equilibrat", detail: "Context suficient sense allargar-se" },
  { value: "detailed", label: "Detallat", detail: "Més explicació i raonament" },
];

export function MemberOnboarding({
  profile,
  capabilities,
  memberName,
  tenantName,
  assistantName,
}: {
  profile: MemberOnboardingProfile;
  capabilities: string[];
  memberName: string;
  tenantName: string;
  assistantName: string;
}) {
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState(profile.preferences.language);
  const [responseStyle, setResponseStyle] = useState(profile.preferences.responseStyle);
  const [feedback, setFeedback] = useState(profile.responsibilityFeedback);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assignment = profile.assignment;

  async function complete() {
    if (!assignment || submitting) return;
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/onboarding/member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, responseStyle, responsibilityFeedback: feedback }),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setSubmitting(false);
      setError(result && typeof result === "object" && "error" in result &&
        typeof result.error === "string" ? result.error : "No s’ha pogut completar l’onboarding.");
      return;
    }
    const params = new URLSearchParams({ starter: assignment.firstMission, onboarding: "complete" });
    window.location.assign(`/?${params.toString()}`);
  }

  if (!assignment) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#f1f2ef] px-5 py-10 text-[#292825]">
        <section className="w-full max-w-lg rounded-3xl border border-[#deddd8] bg-[#fbfbfa] p-7 shadow-[0_24px_70px_-48px_rgba(35,32,27,.55)] md:p-10">
          <span className="grid size-11 place-items-center rounded-2xl bg-[#fff2e8] text-[#9a5b37]"><Flag size={20} /></span>
          <p className="mt-8 text-[10px] font-semibold uppercase tracking-[.16em] text-[#96928b]">Configuració pendent</p>
          <h1 className="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-.045em]">El teu rol encara no està definit.</h1>
          <p className="mt-4 text-[12px] leading-6 text-[#77736d]">Demana a l’admin de {tenantName} que assigni les teves responsabilitats i primera missió. AiBrain no inventarà permisos ni funcions per tu.</p>
          <form action="/api/auth/logout" method="post" className="mt-8">
            <button className="rounded-xl border border-[#d7d5d0] bg-white px-4 py-2.5 text-[10px] font-semibold text-[#4b4843]">Tanca la sessió</button>
          </form>
        </section>
      </main>
    );
  }

  const steps = [
    { label: "El teu rol", icon: Briefcase },
    { label: "Preferències", icon: SlidersHorizontal },
    { label: "Primera missió", icon: RocketLaunch },
  ];

  return (
    <main className="min-h-[100dvh] bg-[#f1f2ef] px-4 py-5 text-[#292825] md:px-8 md:py-9">
      <div className="mx-auto grid min-h-[calc(100dvh-4.5rem)] max-w-[1120px] overflow-hidden rounded-[28px] border border-[#dcdad5] bg-[#fbfbfa] shadow-[0_30px_90px_-58px_rgba(35,32,27,.6)] lg:grid-cols-[340px_1fr]">
        <aside className="flex flex-col bg-[#222320] p-5 text-white md:p-8">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-white text-[#222320]"><span className="text-[12px] font-bold">AI</span></span>
            <div><p className="text-[11px] font-semibold">{assistantName}</p><p className="mt-0.5 text-[8px] text-white/45">{tenantName}</p></div>
          </div>
          <div className="mt-8 lg:mt-14">
            <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-white/40">Benvingut, {memberName}</p>
            <h1 className="mt-3 text-[25px] font-semibold leading-[1.04] tracking-[-.045em] lg:mt-4 lg:text-[30px]">Tot preparat per començar a treballar.</h1>
            <p className="mt-4 hidden text-[10px] leading-5 text-white/50 sm:block">L’empresa ja ha configurat el context, les eines i els límits. Tu només confirmes com vols treballar.</p>
          </div>
          <ol className="mt-7 grid grid-cols-3 gap-2 lg:mt-12 lg:block lg:space-y-3">
            {steps.map((item, index) => {
              const Icon = item.icon;
              const active = index === step;
              const complete = index < step;
              return (
                <li key={item.label} className={`flex flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 text-[10px] transition lg:flex-row lg:gap-3 lg:px-3 lg:py-3 ${active ? "bg-white/10 text-white" : "text-white/42"}`}>
                  <span className={`grid size-7 place-items-center rounded-lg ${active || complete ? "bg-white text-[#222320]" : "bg-white/7"}`}>{complete ? <Check size={12} weight="bold" /> : <Icon size={13} />}</span>
                  <span className="hidden font-semibold sm:inline">{item.label}</span>
                  <span className="text-[8px] lg:ml-auto">0{index + 1}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-auto hidden items-center gap-2 border-t border-white/10 pt-5 text-[8px] leading-4 text-white/38 lg:flex"><LockKey size={13} /> Els permisos només els pot canviar un admin.</div>
        </aside>

        <section className="flex min-h-[620px] flex-col p-6 md:p-10 lg:p-14">
          <div className="mb-10 flex items-center justify-between">
            <div className="flex gap-1.5">{steps.map((item, index) => <span key={item.label} className={`h-1.5 rounded-full transition-all ${index === step ? "w-9 bg-[#292825]" : index < step ? "w-5 bg-[#8a9187]" : "w-5 bg-[#deddd8]"}`} />)}</div>
            <span className="text-[9px] font-medium text-[#99958e]">{step + 1} de {steps.length}</span>
          </div>

          {step === 0 ? (
            <div className="panel-enter max-w-2xl">
              <p className="text-[9px] font-semibold uppercase tracking-[.17em] text-[#99958e]">Assignat per l’admin</p>
              <h2 className="mt-3 text-[34px] font-semibold tracking-[-.045em]">{assignment.jobTitle}</h2>
              <p className="mt-4 max-w-[60ch] text-[12px] leading-6 text-[#716e68]">{assignment.summary}</p>
              <div className="mt-8 rounded-2xl border border-[#dfddd8] bg-white p-5 md:p-6">
                <h3 className="text-[10px] font-semibold">Les teves responsabilitats</h3>
                <ul className="mt-4 space-y-3">
                  {assignment.responsibilities.map((responsibility) => <li key={responsibility} className="flex items-start gap-3 text-[11px] leading-5 text-[#5f5b56]"><CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0 text-[#6f806d]" />{responsibility}</li>)}
                </ul>
              </div>
              <label className="mt-6 block">
                <span className="text-[9px] font-semibold text-[#77736d]">Alguna cosa no encaixa? <span className="font-normal text-[#aaa69f]">Opcional · no canvia permisos automàticament</span></span>
                <textarea maxLength={500} rows={3} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Ex.: També coordino els proveïdors externs." className="mt-2 w-full resize-none rounded-xl border border-[#d9d7d2] bg-white px-4 py-3 text-[11px] leading-5 outline-none focus:border-[#99958e]" />
              </label>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="panel-enter max-w-2xl">
              <p className="text-[9px] font-semibold uppercase tracking-[.17em] text-[#99958e]">La teva manera de treballar</p>
              <h2 className="mt-3 text-[34px] font-semibold tracking-[-.045em]">Personalitza només el que és teu.</h2>
              <div className="mt-8 grid gap-6">
                <fieldset>
                  <legend className="text-[9px] font-semibold text-[#77736d]">Idioma habitual</legend>
                  <div className="mt-3 flex flex-wrap gap-2">{languageOptions.map((option) => <button type="button" key={option.value} aria-pressed={language === option.value} onClick={() => setLanguage(option.value)} className={`rounded-xl border px-4 py-3 text-[10px] font-semibold transition ${language === option.value ? "border-[#292825] bg-[#292825] text-white" : "border-[#d9d7d2] bg-white text-[#5f5b56] hover:border-[#aaa69f]"}`}>{option.label}</button>)}</div>
                </fieldset>
                <fieldset>
                  <legend className="text-[9px] font-semibold text-[#77736d]">Nivell de detall</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">{responseOptions.map((option) => <button type="button" key={option.value} aria-pressed={responseStyle === option.value} onClick={() => setResponseStyle(option.value)} className={`rounded-xl border p-4 text-left transition ${responseStyle === option.value ? "border-[#292825] bg-[#f1f1ee]" : "border-[#d9d7d2] bg-white hover:border-[#aaa69f]"}`}><span className="block text-[10px] font-semibold">{option.label}</span><span className="mt-1.5 block text-[9px] leading-4 text-[#8b8780]">{option.detail}</span></button>)}</div>
                </fieldset>
              </div>
              <div className="mt-8 rounded-2xl bg-[#eeefec] p-5">
                <div className="flex items-center gap-2"><LockKey size={14} /><h3 className="text-[10px] font-semibold">Configurat per {tenantName}</h3></div>
                <div className="mt-4 flex flex-wrap gap-2">{capabilities.map((capability) => <span key={capability} className="rounded-lg border border-[#d8d9d5] bg-white/70 px-2.5 py-1.5 text-[9px] text-[#69665f]">{capability}</span>)}</div>
                <p className="mt-4 text-[9px] leading-4 text-[#817e77]">Pots utilitzar aquestes funcions, però no canviar-ne els permisos ni les polítiques.</p>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="panel-enter max-w-2xl">
              <p className="text-[9px] font-semibold uppercase tracking-[.17em] text-[#99958e]">El teu primer resultat</p>
              <h2 className="mt-3 text-[34px] font-semibold tracking-[-.045em]">Comencem fent, no explicant.</h2>
              <p className="mt-4 text-[12px] leading-6 text-[#716e68]">L’admin ha preparat aquesta primera missió perquè coneguis AiBrain dins del teu treball real.</p>
              <div className="mt-8 rounded-2xl border border-[#d9d7d2] bg-white p-6 md:p-8">
                <span className="grid size-10 place-items-center rounded-xl bg-[#292825] text-white"><RocketLaunch size={18} /></span>
                <p className="mt-7 text-[18px] font-semibold leading-7 tracking-[-.02em]">{assignment.firstMission}</p>
                <div className="mt-6 flex items-center gap-2 text-[9px] text-[#8e8a83]"><CheckCircle size={13} /> S’obrirà preparada al workbench; tu decidiràs quan enviar-la.</div>
              </div>
              {error ? <p role="alert" className="mt-5 rounded-xl bg-[#fff0ea] px-4 py-3 text-[10px] text-[#8b4f3c]">{error}</p> : null}
            </div>
          ) : null}

          <div className="mt-auto flex items-center justify-between border-t border-[#e5e3df] pt-6">
            <button type="button" disabled={step === 0 || submitting} onClick={() => setStep((current) => Math.max(0, current - 1))} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[10px] font-semibold text-[#77736d] hover:bg-[#f0efec] disabled:invisible"><ArrowLeft size={13} /> Enrere</button>
            {step < steps.length - 1 ? (
              <button type="button" onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))} className="flex items-center gap-2 rounded-xl bg-[#292825] px-5 py-3 text-[10px] font-semibold text-white">Continua <ArrowRight size={13} /></button>
            ) : (
              <button type="button" disabled={submitting} onClick={() => void complete()} className="flex items-center gap-2 rounded-xl bg-[#292825] px-5 py-3 text-[10px] font-semibold text-white disabled:opacity-50">{submitting ? "Preparant…" : "Comença la missió"}<RocketLaunch size={13} /></button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
