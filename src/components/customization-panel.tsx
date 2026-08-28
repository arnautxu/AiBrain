"use client";

import {
  Check,
  Gauge,
  PaintBrush,
  UsersThree,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import type { BrainPreferences, CornerStyle, Density } from "@/config/brain";
import type { RuntimeStatus } from "@/lib/runtime-status";
import type { CompanyUsageResponse, PersonalUsageResponse } from "@/usage/contracts";
import { useModalFocus } from "@/ui/use-modal-focus";
import { ThemeToggle } from "@/components/ui/primitives";

type CustomizationPanelProps = {
  productName: string;
  open: boolean;
  preferences: BrainPreferences;
  runtimeStatus: RuntimeStatus;
  selectedSkill: string | null;
  onSelectedSkillChange: (skillId: string | null) => void;
  onChange: <Key extends keyof BrainPreferences>(key: Key, value: BrainPreferences[Key]) => void;
  onReset: () => void;
  onClose: () => void;
};

type SettingsTab = "appearance" | "skills" | "team" | "usage";
type TeamMember = { userId: string; displayName: string; email: string; workerId: string };

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(value);
}

function planPercent(usage: PersonalUsageResponse | CompanyUsageResponse | null) {
  const windows = usage?.sharedSubscription?.rateLimits.flatMap((bucket) =>
    [bucket.primary, bucket.secondary].filter((item): item is NonNullable<typeof item> => Boolean(item))) ?? [];
  return windows.length ? Math.max(...windows.map((item) => item.usedPercent)) : null;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button aria-label={label} aria-pressed={checked} className={`touch-target relative h-5 w-9 rounded-full transition ${checked ? "bg-[var(--brain-accent)]" : "bg-[var(--border-strong)]"}`} onClick={() => onChange(!checked)}>
      <span className={`absolute top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-full bg-[var(--surface-raised)] shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}>
        {checked ? <Check size={8} weight="bold" className="text-[var(--brain-accent)]" /> : null}
      </span>
    </button>
  );
}

export function CustomizationPanel({
  productName,
  open,
  preferences,
  runtimeStatus,
  selectedSkill,
  onSelectedSkillChange,
  onChange,
  onReset,
  onClose,
}: CustomizationPanelProps) {
  const panelRef = useModalFocus(open, onClose);
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [personalUsage, setPersonalUsage] = useState<PersonalUsageResponse | null>(null);
  const [companyUsage, setCompanyUsage] = useState<CompanyUsageResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      fetch("/api/settings/team", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<{ members?: TeamMember[] }> : null),
      fetch("/api/usage/me", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<PersonalUsageResponse> : null),
      fetch("/api/usage/company", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<CompanyUsageResponse> : null),
    ]).then(([teamResponse, personal, company]) => {
      if (cancelled) return;
      setTeam(Array.isArray(teamResponse?.members) ? teamResponse.members : []);
      setPersonalUsage(personal);
      setCompanyUsage(company);
    });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const usage = companyUsage ?? personalUsage;
  const usedPercent = planPercent(usage);
  const loadingData = !usage && team.length === 0;
  const tabs: Array<{ id: SettingsTab; label: string; icon: ReactNode }> = [
    { id: "appearance", label: "Apariencia", icon: <PaintBrush size={17} /> },
    { id: "skills", label: "Skills", icon: <Wrench size={17} /> },
    { id: "team", label: "Equipo", icon: <UsersThree size={17} /> },
    { id: "usage", label: "Usage", icon: <Gauge size={17} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--overlay)] p-0 backdrop-blur-[2px] md:p-6">
      <button className="absolute inset-0" aria-label="Cerrar configuración" onClick={onClose} />
      <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Preferencias de ${productName}`} className="panel-enter relative flex h-full w-full max-w-[980px] flex-col overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)] md:h-[min(760px,calc(100dvh-3rem))] md:rounded-[24px]">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5">
          <h2 id="preferences-title" className="text-[14px] font-semibold text-[var(--text)]">Configuración de {productName}</h2>
          <button aria-label="Cerrar" className="rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-hover)]" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav aria-label="Secciones de configuración" className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] p-2 md:w-52 md:flex-col md:border-b-0 md:border-r md:p-3">
            {tabs.map((item) => <button key={item.id} aria-current={tab === item.id ? "page" : undefined} className={`flex min-h-10 shrink-0 items-center gap-2.5 rounded-[12px] px-3 text-left text-[12px] font-medium transition ${tab === item.id ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`} onClick={() => setTab(item.id)}>{item.icon}{item.label}</button>)}
          </nav>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
            {tab === "appearance" ? <div className="space-y-8">
              <section>
              <SectionTitle>Asistente</SectionTitle>
              <label className="block">
                <span className="mb-2 block text-[12px] font-medium text-[var(--text-secondary)]">Nombre del asistente</span>
                <input className="w-full rounded-[var(--brain-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[13px] text-[var(--text)] outline-none focus:border-[var(--brain-accent)]" maxLength={32} value={preferences.assistantName} onChange={(event) => onChange("assistantName", event.target.value)} />
              </label>
              <div className="mt-5">
                <SegmentedControl
                  label="Estilo de respuesta"
                  value={preferences.tone}
                  options={[{ value: "direct", label: "Directo" }, { value: "balanced", label: "Equilibrado" }, { value: "detailed", label: "Detallado" }]}
                  onChange={(value) => onChange("tone", value)}
                />
              </div>
              </section>

              <section>
                <SectionTitle>Tema</SectionTitle>
                <div className="flex items-center justify-between rounded-[var(--brain-radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"><div><p className="text-[12px] font-semibold text-[var(--text)]">Claro u oscuro</p><p className="mt-1 text-[11px] text-[var(--text-subtle)]">Se guarda en este navegador.</p></div><ThemeToggle /></div>
                <div className="mt-5"><SegmentedControl label="Color" value={preferences.accent} options={[{ value: "graphite", label: "Grafito" }, { value: "blue", label: "Azul" }, { value: "violet", label: "Violeta" }]} onChange={(value) => onChange("accent", value)} /></div>
              </section>

              <section>
                <SectionTitle>Interfaz</SectionTitle>
              <div><SegmentedControl<Density> label="Densidad" value={preferences.density} options={[{ value: "comfortable", label: "Cómoda" }, { value: "compact", label: "Compacta" }]} onChange={(value) => onChange("density", value)} /></div>
              <div className="mt-5"><SegmentedControl<CornerStyle> label="Contornos" value={preferences.corners} options={[{ value: "soft", label: "Suaves" }, { value: "rounded", label: "Redondos" }, { value: "precise", label: "Precisos" }]} onChange={(value) => onChange("corners", value)} /></div>
              </section>

              <section>
                <SectionTitle>Conversación</SectionTitle>
                <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
                <PreferenceToggle title="Mostrar progreso" description="Enseña los pasos relevantes mientras se prepara el resultado." checked={preferences.showActivityPanel} onChange={(value) => onChange("showActivityPanel", value)} />
                <PreferenceToggle title="Panel de revisión" description="Permite revisar el progreso, las decisiones y los cambios en un panel lateral." checked={preferences.showInspector} onChange={(value) => onChange("showInspector", value)} />
                <PreferenceToggle title="Recordar la última conversación" description="Vuelve a abrir el último proyecto y conversación en este navegador." checked={preferences.conversationMemory} onChange={(value) => onChange("conversationMemory", value)} />
                </div>
              </section>
            </div> : null}

            {tab === "skills" ? <section>
              <SectionTitle>Skill predeterminada</SectionTitle>
              <p className="mb-5 text-[12px] leading-5 text-[var(--text-muted)]">Elige la skill que aparecerá seleccionada al trabajar. Las skills disponibles se instalan y revisan en el servidor de esta empresa.</p>
              <div className="space-y-2">
                <button className={`w-full rounded-[14px] border p-4 text-left ${selectedSkill === null ? "border-[var(--brain-accent)] bg-[var(--brain-accent-soft)]" : "border-[var(--border)]"}`} onClick={() => onSelectedSkillChange(null)}><p className="text-[12px] font-semibold">Sin skill predeterminada</p><p className="mt-1 text-[11px] text-[var(--text-subtle)]">El asistente decide con las herramientas base.</p></button>
                {runtimeStatus.skills.map((skill) => <button key={skill.id} className={`w-full rounded-[14px] border p-4 text-left ${selectedSkill === skill.id ? "border-[var(--brain-accent)] bg-[var(--brain-accent-soft)]" : "border-[var(--border)] hover:bg-[var(--surface-hover)]"}`} onClick={() => onSelectedSkillChange(skill.id)}><p className="text-[12px] font-semibold text-[var(--text)]">{skill.label}</p><p className="mt-1 text-[11px] leading-4 text-[var(--text-subtle)]">{skill.description}</p></button>)}
                {!runtimeStatus.skills.length ? <p className="rounded-[14px] border border-dashed border-[var(--border)] p-5 text-[12px] text-[var(--text-subtle)]">No hay skills instaladas para este usuario todavía.</p> : null}
              </div>
            </section> : null}

            {tab === "team" ? <section>
              <SectionTitle>Personas y workers</SectionTitle>
              <p className="mb-5 text-[12px] leading-5 text-[var(--text-muted)]">Cada persona tiene login, historial, workspace, navegador y worker aislados.</p>
              <div className="divide-y divide-[var(--border-subtle)] rounded-[16px] border border-[var(--border)]">
                {team.map((member) => <div key={member.userId} className="flex items-center gap-3 px-4 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[12px] font-semibold">{member.displayName.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold">{member.displayName}</p><p className="truncate text-[10px] text-[var(--text-subtle)]">{member.email}</p></div><span className="rounded-full bg-[var(--positive-soft)] px-2 py-1 text-[9px] font-semibold text-[var(--positive)]">Activo</span></div>)}
                {!team.length ? <p className="p-5 text-[12px] text-[var(--text-subtle)]">{loadingData ? "Cargando equipo…" : "No se ha podido cargar el equipo."}</p> : null}
              </div>
            </section> : null}

            {tab === "usage" ? <section>
              <SectionTitle>Suscripción compartida</SectionTitle>
              <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="flex items-end justify-between gap-4"><div><p className="text-[12px] font-semibold text-[var(--text)]">Plan {usage?.sharedSubscription?.planType ?? runtimeStatus.planType ?? "Codex"}</p><p className="mt-1 text-[11px] text-[var(--text-subtle)]">Consumo global de la cuenta conectada</p></div><p className="text-[28px] font-semibold tracking-[-.03em]">{usedPercent === null ? "—" : `${Math.round(usedPercent)}%`}</p></div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-[var(--brain-accent)] transition-[width]" style={{ width: `${usedPercent ?? 0}%` }} /></div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric label="Turns" value={formatNumber((companyUsage ?? personalUsage)?.internal.turns ?? 0)} />
                <Metric label="Tokens medidos" value={formatNumber((companyUsage ?? personalUsage)?.internal.tokens.totalTokens ?? 0)} />
                <Metric label="Primer texto medio" value={(companyUsage ?? personalUsage)?.internal.averageFirstTextMs === null || !(companyUsage ?? personalUsage) ? "—" : `${formatNumber((companyUsage ?? personalUsage)!.internal.averageFirstTextMs!)} ms`} />
              </div>
              {companyUsage ? <div className="mt-7"><SectionTitle>Uso por empleado</SectionTitle><div className="divide-y divide-[var(--border-subtle)] rounded-[16px] border border-[var(--border)]">{companyUsage.members.map((member) => <div key={member.userId} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 text-[11px]"><span className="truncate font-semibold">{member.displayName}</span><span className="text-[var(--text-subtle)]">{formatNumber(member.usage.turns)} turns</span><span className="min-w-20 text-right text-[var(--text-secondary)]">{formatNumber(member.usage.tokens.totalTokens)} tok.</span></div>)}</div></div> : null}
              {!usage && !loadingData ? <p className="mt-4 text-[11px] text-[var(--danger)]">No se ha podido cargar el uso ahora mismo.</p> : null}
            </section> : null}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-5 py-3.5">
          <button className={`text-[11px] font-semibold text-[var(--text-subtle)] hover:text-[var(--text)] ${tab === "appearance" ? "visible" : "invisible"}`} onClick={onReset}>Restablecer apariencia</button>
          <button className="rounded-lg bg-[var(--brain-accent)] px-4 py-2 text-[12px] font-semibold text-[var(--brain-contrast)]" onClick={onClose}>Cerrar</button>
        </footer>
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">{children}</h3>;
}

function SegmentedControl<Value extends string>({ label, value, options, onChange }: { label: string; value: Value; options: Array<{ value: Value; label: string }>; onChange: (value: Value) => void }) {
  return (
    <div>
      <span className="mb-2 block text-[12px] font-medium text-[var(--text-secondary)]">{label}</span>
      <div className="grid auto-cols-fr grid-flow-col rounded-lg bg-[var(--surface-muted)] p-1">
        {options.map((option) => <button key={option.value} className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition ${option.value === value ? "bg-[var(--surface-raised)] text-[var(--text)] shadow-sm" : "text-[var(--text-subtle)] hover:text-[var(--text)]"}`} onClick={() => onChange(option.value)}>{option.label}</button>)}
      </div>
    </div>
  );
}

function PreferenceToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <div className="min-w-0 flex-1"><p className="text-[12px] font-semibold text-[var(--text)]">{title}</p><p className="mt-1 text-[11px] leading-4 text-[var(--text-subtle)]">{description}</p></div>
      <Toggle label={title} checked={checked} onChange={onChange} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[14px] border border-[var(--border)] p-4"><p className="text-[10px] font-medium text-[var(--text-subtle)]">{label}</p><p className="mt-2 text-[18px] font-semibold text-[var(--text)]">{value}</p></div>;
}
