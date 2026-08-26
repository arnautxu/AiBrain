import { Check, Code, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { AccentName, BrainPreferences, CornerStyle, Density } from "@/config/brain";

type CustomizationPanelProps = {
  productName: string;
  open: boolean;
  preferences: BrainPreferences;
  onChange: <Key extends keyof BrainPreferences>(key: Key, value: BrainPreferences[Key]) => void;
  onReset: () => void;
  onClose: () => void;
};

const accents: Array<{ value: AccentName; label: string; color: string }> = [
  { value: "graphite", label: "Grafit", color: "#171717" },
  { value: "blue", label: "Blau", color: "#315ee7" },
  { value: "violet", label: "Violeta", color: "#7656d8" },
];

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button aria-label={label} aria-pressed={checked} className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-[var(--brain-accent)]" : "bg-[#d4d2cd]"}`} onClick={() => onChange(!checked)}>
      <span className={`absolute top-0.5 grid size-4 place-items-center rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}>
        {checked ? <Check size={8} weight="bold" className="text-[var(--brain-accent)]" /> : null}
      </span>
    </button>
  );
}

export function CustomizationPanel({ productName, open, preferences, onChange, onReset, onClose }: CustomizationPanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-[2px]">
      <button className="absolute inset-0" aria-label="Tancar personalització" onClick={onClose} />
      <aside className="panel-enter relative flex h-full w-full max-w-[430px] flex-col border-l border-[#deddd9] bg-[#fafaf8] shadow-[-30px_0_70px_-42px_rgba(0,0,0,.6)]">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#deddd9] px-5">
          <div className="flex items-center gap-2"><Code size={14} /><h2 className="text-[11px] font-semibold text-[#302e2b]">Personalitza {productName}</h2></div>
          <button aria-label="Tancar" className="rounded-md p-1.5 text-[#77746f] hover:bg-[#ecebe7]" onClick={onClose}><X size={15} /></button>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <p className="mb-7 rounded-[var(--brain-radius)] border border-[#e1e0dc] bg-white px-3.5 py-3 text-[10px] leading-5 text-[#77746f]">
            Aquesta capa ja és pròpia: identitat, densitat, color, inspector i comportament es defineixen sense modificar el runtime de Codex.
          </p>

          <div className="space-y-8">
            <section>
              <SectionTitle>Identitat</SectionTitle>
              <label className="block">
                <span className="mb-2 block text-[10px] font-medium text-[#57544f]">Nom de l’agent</span>
                <input className="w-full rounded-[var(--brain-radius)] border border-[#dcdad5] bg-white px-3 py-2.5 text-[11px] text-[#33312e] outline-none focus:border-[#aaa7a1]" maxLength={32} value={preferences.assistantName} onChange={(event) => onChange("assistantName", event.target.value)} />
              </label>
              <div className="mt-5">
                <SegmentedControl
                  label="To de resposta"
                  value={preferences.tone}
                  options={[{ value: "direct", label: "Directe" }, { value: "balanced", label: "Equilibrat" }, { value: "detailed", label: "Detallat" }]}
                  onChange={(value) => onChange("tone", value)}
                />
              </div>
            </section>

            <section>
              <SectionTitle>Interfície</SectionTitle>
              <div>
                <span className="mb-2 block text-[10px] font-medium text-[#57544f]">Accent</span>
                <div className="grid grid-cols-3 gap-2">
                  {accents.map((accent) => (
                    <button key={accent.value} className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-[9px] font-medium ${preferences.accent === accent.value ? "border-[#aaa7a1] text-[#33312e]" : "border-[#e0dfdb] text-[#77746f] hover:border-[#c9c7c2]"}`} onClick={() => onChange("accent", accent.value)}>
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: accent.color }} />{accent.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5"><SegmentedControl<Density> label="Densitat" value={preferences.density} options={[{ value: "comfortable", label: "Còmoda" }, { value: "compact", label: "Compacta" }]} onChange={(value) => onChange("density", value)} /></div>
              <div className="mt-5"><SegmentedControl<CornerStyle> label="Contorns" value={preferences.corners} options={[{ value: "soft", label: "Suaus" }, { value: "rounded", label: "Rodons" }, { value: "precise", label: "Precisos" }]} onChange={(value) => onChange("corners", value)} /></div>
            </section>

            <section>
              <SectionTitle>Superfícies</SectionTitle>
              <div className="divide-y divide-[#e4e2de] border-y border-[#e4e2de]">
                <PreferenceToggle title="Activitat dins del fil" description="Mostra plans, ordres i eines mentre Codex treballa." checked={preferences.showActivityPanel} onChange={(value) => onChange("showActivityPanel", value)} />
                <PreferenceToggle title="Inspector lateral" description="Permet obrir el pla, les aprovacions i el diff en una finestra pròpia." checked={preferences.showInspector} onChange={(value) => onChange("showInspector", value)} />
                <PreferenceToggle title="Recorda l’últim fil" description="Torna a obrir el darrer projecte i fil en aquest navegador. Els missatges es persisteixen al servidor." checked={preferences.conversationMemory} onChange={(value) => onChange("conversationMemory", value)} />
              </div>
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-[#deddd9] px-5 py-3.5">
          <button className="text-[9px] font-semibold text-[#85827c] hover:text-[#45423e]" onClick={onReset}>Restableix</button>
          <button className="rounded-lg bg-[var(--brain-accent)] px-4 py-2 text-[10px] font-semibold text-[var(--brain-contrast)]" onClick={onClose}>Aplica</button>
        </footer>
      </aside>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-4 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#918e88]">{children}</h3>;
}

function SegmentedControl<Value extends string>({ label, value, options, onChange }: { label: string; value: Value; options: Array<{ value: Value; label: string }>; onChange: (value: Value) => void }) {
  return (
    <div>
      <span className="mb-2 block text-[10px] font-medium text-[#57544f]">{label}</span>
      <div className="grid auto-cols-fr grid-flow-col rounded-lg bg-[#edebe7] p-1">
        {options.map((option) => <button key={option.value} className={`rounded-md px-2 py-1.5 text-[9px] font-medium transition ${option.value === value ? "bg-white text-[#34322f] shadow-sm" : "text-[#87847e] hover:text-[#4d4a46]"}`} onClick={() => onChange(option.value)}>{option.label}</button>)}
      </div>
    </div>
  );
}

function PreferenceToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold text-[#4a4743]">{title}</p><p className="mt-1 text-[9px] leading-4 text-[#918e88]">{description}</p></div>
      <Toggle label={title} checked={checked} onChange={onChange} />
    </div>
  );
}
