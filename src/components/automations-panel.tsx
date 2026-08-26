"use client";

import { useEffect, useState } from "react";
import { ArrowClockwise, CheckCircle, Play, SpinnerGap, WarningCircle, X } from "@phosphor-icons/react";
import type { AutomationDefinition, AutomationRun } from "@/lib/automation-contract";

export function AutomationsPanel({ projectId, open, onClose }: { projectId: string | null; open: boolean; onClose: () => void }) {
  const [automations, setAutomations] = useState<AutomationDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<AutomationDefinition["id"] | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch("/api/automations", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("No s’ha pogut carregar el catàleg.")))
      .then((body: { automations?: AutomationDefinition[] }) => {
        const next = Array.isArray(body.automations) ? body.automations : [];
        setAutomations(next);
        setSelectedId((current) => current ?? next[0]?.id ?? null);
      })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Catàleg no disponible."); });
    return () => controller.abort();
  }, [open]);

  const selected = automations.find((automation) => automation.id === selectedId) ?? null;
  const execute = async () => {
    if (!selected || !projectId || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, automationId: selected.id }) });
      const body: { run?: AutomationRun; error?: string } = await response.json();
      if (!response.ok || !body.run) throw new Error(body.error ?? "Execució no disponible.");
      setRuns((current) => [body.run as AutomationRun, ...current].slice(0, 12));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "L’automatització ha fallat."); }
    finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <aside className="panel-enter fixed inset-y-0 right-0 z-30 flex w-full max-w-[720px] flex-col border-l border-[#deddd9] bg-[#f7f7f5] shadow-[-24px_0_48px_-40px_rgba(0,0,0,.45)] xl:static xl:max-w-[620px] xl:shadow-none">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#deddd9] px-4"><div className="flex items-center gap-2"><ArrowClockwise size={14} /><h2 className="text-[11px] font-semibold">Automatitzacions</h2><span className="text-[9px] text-[#96928b]">{automations.length} registrades</span></div><button aria-label="Tanca automatitzacions" className="rounded-md p-1.5 text-[#77746f] hover:bg-[#ebeae6]" onClick={onClose}><X size={15} /></button></header>
      <div className="grid min-h-0 flex-1 md:grid-cols-[240px_1fr]">
        <nav className="scrollbar-thin overflow-y-auto border-b border-[#deddd9] p-3 md:border-b-0 md:border-r">
          {automations.map((automation) => <button key={automation.id} className={`mb-1 w-full rounded-xl px-3 py-3 text-left transition ${selectedId === automation.id ? "bg-[#e5e4df]" : "hover:bg-[#eeede9]"}`} onClick={() => setSelectedId(automation.id)}><span className="block text-[10px] font-semibold text-[#393733]">{automation.name}</span><span className="mt-1 block text-[8px] leading-4 text-[#8b8780]">{automation.description}</span></button>)}
        </nav>
        <section className="scrollbar-thin min-h-0 overflow-y-auto p-5">
          {selected ? <><p className="text-[9px] font-medium text-[#8b8780]">{selected.category === "runtime" ? "Runtime" : "Workspace"} · només lectura</p><h3 className="mt-2 text-[22px] font-semibold tracking-[-.035em] text-[#2b2926]">{selected.name}</h3><p className="mt-3 max-w-[52ch] text-[11px] leading-5 text-[#77736d]">{selected.description}</p><button disabled={!projectId || busy} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--brain-accent)] px-3 py-2 text-[10px] font-semibold text-[var(--brain-contrast)] disabled:opacity-40" onClick={() => void execute()}>{busy ? <SpinnerGap size={13} className="animate-spin" /> : <Play size={12} weight="fill" />}{busy ? "Executant" : "Executa ara"}</button></> : null}
          {error ? <div className="mt-5 flex gap-2 rounded-lg border border-[#ead0c7] bg-[#fff8f5] p-3 text-[9px] text-[#884b38]"><WarningCircle size={13} />{error}</div> : null}
          {runs.length ? <div className="mt-7"><h4 className="text-[9px] font-semibold text-[#827e77]">Execucions d’aquesta sessió</h4><div className="mt-3 space-y-3">{runs.map((run) => <article key={run.id} className="rounded-xl border border-[#dfded9] bg-white p-3"><div className="flex items-center gap-2 text-[9px] font-medium text-[#4d4a46]">{run.status === "completed" ? <CheckCircle size={12} className="text-[#568060]" /> : <WarningCircle size={12} className="text-[#9a5945]" />}{automations.find((item) => item.id === run.automationId)?.name}<span className="ml-auto text-[8px] font-normal text-[#9b9790]">{new Date(run.finishedAt).toLocaleTimeString("ca", { hour: "2-digit", minute: "2-digit" })}</span></div><pre className="scrollbar-thin mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-[#242421] p-3 font-mono text-[9px] leading-4 text-[#e4e2dc]">{run.output}</pre></article>)}</div></div> : <div className="mt-10 border-t border-[#e1dfda] pt-5 text-[9px] leading-4 text-[#99958e]">Les execucions apareixeran aquí. El navegador no pot enviar comandes arbitràries: cada automatització té un executor registrat al servidor.</div>}
        </section>
      </div>
    </aside>
  );
}
