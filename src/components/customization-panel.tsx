import { Check, Code, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { BrainPreferences, CornerStyle, Density } from "@/config/brain";
import { useModalFocus } from "@/ui/use-modal-focus";

type CustomizationPanelProps = {
  productName: string;
  open: boolean;
  preferences: BrainPreferences;
  onChange: <Key extends keyof BrainPreferences>(key: Key, value: BrainPreferences[Key]) => void;
  onReset: () => void;
  onClose: () => void;
};

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button aria-label={label} aria-pressed={checked} className={`touch-target relative h-5 w-9 rounded-full transition ${checked ? "bg-[var(--brain-accent)]" : "bg-[var(--border-strong)]"}`} onClick={() => onChange(!checked)}>
      <span className={`absolute top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-full bg-[var(--surface-raised)] shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}>
        {checked ? <Check size={8} weight="bold" className="text-[var(--brain-accent)]" /> : null}
      </span>
    </button>
  );
}

export function CustomizationPanel({ productName, open, preferences, onChange, onReset, onClose }: CustomizationPanelProps) {
  const panelRef = useModalFocus(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay)] backdrop-blur-[2px]">
      <button className="absolute inset-0" aria-label="Cerrar preferencias" onClick={onClose} />
      <aside ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="preferences-title" className="panel-enter relative flex h-full w-full max-w-[430px] flex-col border-l border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5">
          <div className="flex items-center gap-2"><Code size={15} /><h2 id="preferences-title" className="text-[13px] font-semibold text-[var(--text)]">Preferencias de {productName}</h2></div>
          <button aria-label="Cerrar" className="rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-hover)]" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <p className="mb-7 rounded-[var(--brain-radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-[12px] leading-5 text-[var(--text-muted)]">
            Ajusta cómo responde el asistente y cómo se presenta tu espacio de trabajo. La identidad de la empresa se mantiene igual para todo el equipo.
          </p>

          <div className="space-y-8">
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
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-5 py-3.5">
          <button className="text-[11px] font-semibold text-[var(--text-subtle)] hover:text-[var(--text)]" onClick={onReset}>Restablecer</button>
          <button className="rounded-lg bg-[var(--brain-accent)] px-4 py-2 text-[12px] font-semibold text-[var(--brain-contrast)]" onClick={onClose}>Aplicar</button>
        </footer>
      </aside>
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
