"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  EnvelopeSimple,
  FloppyDisk,
  SlidersHorizontal,
  UserPlus,
} from "@phosphor-icons/react";
import type { AuthSession, UserRole } from "@/auth/types";
import type { BrainWindowId } from "@/config/brain";
import type { ManifestEditorData } from "@/control-plane/types";

const windowCopy: Array<{ id: BrainWindowId; title: string; detail: string }> = [
  { id: "chat", title: "Workbench", detail: "Superfície principal obligatòria" },
  { id: "inspector", title: "Inspector", detail: "Pla, activitat, aprovacions i diffs" },
  { id: "runtime", title: "Runtime", detail: "Tenant, sandbox i estat d’aïllament" },
];

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" aria-label={label} aria-pressed={checked} disabled={disabled} className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-[#222320]" : "bg-[#d4d2cd]"} disabled:cursor-not-allowed disabled:opacity-45`} onClick={() => onChange(!checked)}>
      <span className={`absolute top-0.5 grid size-4 place-items-center rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}>{checked ? <Check size={8} weight="bold" /> : null}</span>
    </button>
  );
}

export function ControlPlaneForm({
  initial,
  session,
}: {
  initial: ManifestEditorData;
  session: AuthSession;
}) {
  const [manifest, setManifest] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("member");
  const [inviteState, setInviteState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  function setField<Key extends keyof ManifestEditorData>(key: Key, value: ManifestEditorData[Key]) {
    setState("idle");
    setManifest((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setState("saving");
    setMessage(null);
    const response = await fetch("/api/control-plane/manifest", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setState("error");
      setMessage(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "No s’ha pogut desar.");
      return;
    }
    setState("saved");
    setMessage("Manifest desat. El workbench el carregarà a la pròxima obertura.");
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteState("sending");
    setInviteMessage(null);
    const response = await fetch("/api/control-plane/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setInviteState("error");
      setInviteMessage(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "No s’ha pogut convidar el membre.");
      return;
    }
    const delivery = result && typeof result === "object" && "invitation" in result &&
      result.invitation && typeof result.invitation === "object" && "delivery" in result.invitation
      ? result.invitation.delivery
      : null;
    setInviteState("sent");
    setInviteMessage(delivery === "existing_user"
      ? `${inviteEmail} ja tenia identitat: l’hem afegit al tenant.`
      : `Invitació enviada a ${inviteEmail}.`);
    setInviteEmail("");
  }

  return (
    <main className="min-h-[100dvh] bg-[#f3f3f0] text-[#292825]">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[#deddd8] bg-[#f9f9f7]/92 px-4 backdrop-blur md:px-8">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="Tornar al workbench" className="rounded-lg p-2 text-[#77746e] hover:bg-[#ecebe7]"><ArrowLeft size={15} /></Link>
          <div><p className="text-[11px] font-semibold">Control plane</p><p className="text-[8px] text-[#96938d]">{session.tenant.name}</p></div>
        </div>
        <button onClick={() => void save()} disabled={state === "saving"} className="flex items-center gap-2 rounded-lg bg-[#222320] px-3.5 py-2 text-[10px] font-semibold text-white disabled:opacity-50"><FloppyDisk size={13} />{state === "saving" ? "Desant…" : "Desa manifest"}</button>
      </header>

      <div className="mx-auto grid max-w-[1060px] gap-5 px-5 py-8 lg:grid-cols-[.68fr_1.32fr] lg:px-8 lg:py-12">
        <aside className="h-fit rounded-2xl border border-[#deddd8] bg-[#222320] p-6 text-white lg:sticky lg:top-20">
          <span className="grid size-9 place-items-center rounded-xl bg-white/10"><SlidersHorizontal size={17} /></span>
          <h1 className="mt-8 text-[28px] font-semibold leading-[1.05] tracking-[-.045em]">Configura el producte, no el codi.</h1>
          <p className="mt-4 text-[10px] leading-5 text-white/55">{session.provider === "supabase" ? "Cada desat crea una versió immutable i auditada del tenant." : "Aquesta capa escriu un overlay demo validat per tenant."} El runtime i el contracte Codex es mantenen compartits.</p>
          <dl className="mt-8 space-y-3 border-t border-white/10 pt-5 text-[9px]">
            <div className="flex justify-between gap-4"><dt className="text-white/45">Tenant</dt><dd>{session.tenant.id}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-white/45">Rol</dt><dd>Owner</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-white/45">Persistència</dt><dd>{session.provider === "supabase" ? "Postgres versionat" : "Filesystem demo"}</dd></div>
          </dl>
        </aside>

        <div className="space-y-5">
          <section className="rounded-2xl border border-[#deddd8] bg-[#fbfbfa] p-5 md:p-7">
            <h2 className="text-[12px] font-semibold">Identitat</h2>
            <p className="mt-1 text-[9px] text-[#918e88]">Marca i veu base del tenant.</p>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <Field label="Nom del producte"><input maxLength={48} value={manifest.productName} onChange={(event) => setField("productName", event.target.value)} /></Field>
              <Field label="Nom de l’agent"><input maxLength={32} value={manifest.assistantName} onChange={(event) => setField("assistantName", event.target.value)} /></Field>
              <div className="sm:col-span-2"><Field label="Rol"><input maxLength={80} value={manifest.role} onChange={(event) => setField("role", event.target.value)} /></Field></div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#deddd8] bg-[#fbfbfa] p-5 md:p-7">
            <h2 className="text-[12px] font-semibold">Entrada al workbench</h2>
            <div className="mt-6 space-y-5">
              <Field label="Títol"><input maxLength={90} value={manifest.welcomeTitle} onChange={(event) => setField("welcomeTitle", event.target.value)} /></Field>
              <Field label="Missatge"><textarea rows={3} maxLength={280} value={manifest.welcomeMessage} onChange={(event) => setField("welcomeMessage", event.target.value)} /></Field>
            </div>
          </section>

          <section className="rounded-2xl border border-[#deddd8] bg-[#fbfbfa] p-5 md:p-7">
            <h2 className="text-[12px] font-semibold">Sistema visual</h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-3">
              <Select label="Accent" value={manifest.accent} onChange={(value) => setField("accent", value as ManifestEditorData["accent"])} options={["graphite", "blue", "violet"]} />
              <Select label="Densitat" value={manifest.density} onChange={(value) => setField("density", value as ManifestEditorData["density"])} options={["comfortable", "compact"]} />
              <Select label="Contorns" value={manifest.corners} onChange={(value) => setField("corners", value as ManifestEditorData["corners"])} options={["soft", "rounded", "precise"]} />
            </div>
          </section>

          <section className="rounded-2xl border border-[#deddd8] bg-[#fbfbfa] p-5 md:p-7">
            <h2 className="text-[12px] font-semibold">Registre de finestres</h2>
            <p className="mt-1 text-[9px] text-[#918e88]">Activa només les superfícies que necessita aquest producte.</p>
            <div className="mt-5 divide-y divide-[#e6e4df] border-y border-[#e6e4df]">
              {windowCopy.map((window) => (
                <div key={window.id} className="flex items-center gap-5 py-4">
                  <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold">{window.title}</p><p className="mt-1 text-[9px] text-[#918e88]">{window.detail}</p></div>
                  <Toggle label={`${window.id === "chat" ? "Finestra obligatòria" : "Activar finestra"} ${window.title}`} checked={manifest.windows[window.id]} disabled={window.id === "chat"} onChange={(value) => setField("windows", { ...manifest.windows, [window.id]: value })} />
                </div>
              ))}
              <div className="flex items-center gap-5 py-4">
                <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold">Activitat inline</p><p className="mt-1 text-[9px] text-[#918e88]">Plans i eines dins la conversa</p></div>
                <Toggle label="Activar activitat inline" checked={manifest.showActivityPanel} onChange={(value) => setField("showActivityPanel", value)} />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#deddd8] bg-[#fbfbfa] p-5 md:p-7">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#efefec] text-[#56534e]"><UserPlus size={17} /></span>
              <div>
                <h2 className="text-[12px] font-semibold">Membres i invitacions</h2>
                <p className="mt-1 text-[9px] leading-4 text-[#918e88]">L’alta és privada: Supabase crea la identitat i Postgres assigna tenant i rol en una operació auditada.</p>
              </div>
            </div>
            {session.provider === "supabase" ? (
              <form className="mt-6 grid gap-4 sm:grid-cols-[1fr_150px_auto] sm:items-end" onSubmit={(event) => void invite(event)}>
                <label className="block">
                  <span className="mb-2 block text-[9px] font-semibold text-[#77746e]">Correu</span>
                  <span className="flex items-center gap-2 rounded-lg border border-[#d9d7d2] bg-white px-3 focus-within:border-[#aaa7a1]">
                    <EnvelopeSimple size={14} className="text-[#918e88]" />
                    <input type="email" required maxLength={320} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className="min-w-0 flex-1 bg-transparent py-2.5 text-[10px] outline-none" placeholder="persona@empresa.cat" />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-[9px] font-semibold text-[#77746e]">Rol</span>
                  <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as UserRole)} className="w-full rounded-lg border border-[#d9d7d2] bg-white px-3 py-2.5 text-[10px] outline-none focus:border-[#aaa7a1]">
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                </label>
                <button disabled={inviteState === "sending"} className="rounded-lg bg-[#222320] px-4 py-2.5 text-[10px] font-semibold text-white disabled:opacity-50">{inviteState === "sending" ? "Enviant…" : "Convida"}</button>
              </form>
            ) : (
              <p className="mt-5 rounded-xl bg-[#f1f1ee] px-4 py-3 text-[9px] leading-4 text-[#77746e]">En mode demo les identitats continuen sent una allowlist local. Les invitacions només s’activen amb auth Supabase.</p>
            )}
            {inviteMessage ? <p role="status" className={`mt-4 rounded-xl px-4 py-3 text-[10px] ${inviteState === "error" ? "bg-[#fff1ec] text-[#8d503c]" : "bg-[#eaf3eb] text-[#4a6c50]"}`}>{inviteMessage}</p> : null}
          </section>

          {message ? <p role="status" className={`rounded-xl px-4 py-3 text-[10px] ${state === "error" ? "bg-[#fff1ec] text-[#8d503c]" : "bg-[#eaf3eb] text-[#4a6c50]"}`}>{message}</p> : null}
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactElement<{ className?: string }> }) {
  return <label className="block"><span className="mb-2 block text-[9px] font-semibold text-[#77746e]">{label}</span><span className="block [&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-[#d9d7d2] [&>input]:bg-white [&>input]:px-3 [&>input]:py-2.5 [&>input]:text-[11px] [&>input]:outline-none [&>input]:focus:border-[#aaa7a1] [&>textarea]:w-full [&>textarea]:resize-none [&>textarea]:rounded-lg [&>textarea]:border [&>textarea]:border-[#d9d7d2] [&>textarea]:bg-white [&>textarea]:px-3 [&>textarea]:py-2.5 [&>textarea]:text-[11px] [&>textarea]:leading-5 [&>textarea]:outline-none [&>textarea]:focus:border-[#aaa7a1]">{children}</span></label>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-2 block text-[9px] font-semibold text-[#77746e]">{label}</span><select className="w-full rounded-lg border border-[#d9d7d2] bg-white px-3 py-2.5 text-[10px] outline-none focus:border-[#aaa7a1]" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}
