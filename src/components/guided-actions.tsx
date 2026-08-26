"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChartBar,
  CheckCircle,
  FileText,
  MagicWand,
  Scales,
  Sparkle,
} from "@phosphor-icons/react";

export type GuidedActionId = "analyze" | "create" | "improve" | "summarize" | "compare";

type GuidedAction = {
  id: GuidedActionId;
  label: string;
  detail: string;
  result: string;
  icon: typeof ChartBar;
};

type ProjectTemplate = {
  label: string;
  detail: string;
  action: GuidedActionId;
  goal: string;
};

const actions: GuidedAction[] = [
  { id: "analyze", label: "Analitza", detail: "Troba punts clau, riscos i oportunitats", result: "Una anàlisi clara amb conclusions i següents passos", icon: ChartBar },
  { id: "create", label: "Crea", detail: "Prepara un document, correu o proposta", result: "Un primer esborrany llest per revisar", icon: FileText },
  { id: "improve", label: "Millora", detail: "Fes més clar, complet o efectiu un contingut", result: "Una versió millorada i els canvis explicats", icon: MagicWand },
  { id: "summarize", label: "Resumeix", detail: "Redueix informació llarga al que importa", result: "Un resum adaptat a qui l’ha de llegir", icon: Sparkle },
  { id: "compare", label: "Compara", detail: "Contrasta dues opcions amb criteris útils", result: "Una comparació visual i una recomanació raonada", icon: Scales },
];

const projectTemplates: ProjectTemplate[] = [
  {
    label: "Informe de seguiment",
    detail: "Converteix notes i dades en un informe accionable",
    action: "create",
    goal: "Prepara un informe breu amb situació actual, decisions, riscos i pròxims passos.",
  },
  {
    label: "Resum de reunió",
    detail: "Extreu acords, responsables i dates",
    action: "summarize",
    goal: "Resumeix la reunió per a l’equip, destacant acords, responsables, dates i pendents.",
  },
  {
    label: "Decisió entre opcions",
    detail: "Compara alternatives amb criteris clars",
    action: "compare",
    goal: "Compara cost, temps, risc, impacte i facilitat d’implantació.",
  },
];

const copy: Record<GuidedActionId, {
  heading: string;
  sourceLabel: string;
  sourcePlaceholder: string;
  secondLabel?: string;
  secondPlaceholder?: string;
  goalLabel: string;
  goalPlaceholder: string;
}> = {
  analyze: {
    heading: "Què vols entendre millor?",
    sourceLabel: "Informació que hem d’analitzar",
    sourcePlaceholder: "Enganxa el text, descriu la situació o indica on és la informació…",
    goalLabel: "Què necessites decidir o descobrir?",
    goalPlaceholder: "Ex.: detectar riscos abans de presentar la proposta",
  },
  create: {
    heading: "Què necessites crear?",
    sourceLabel: "Tipus de resultat",
    sourcePlaceholder: "Ex.: un correu a un client, una proposta, un informe o una checklist",
    goalLabel: "Informació que ha d’incloure",
    goalPlaceholder: "Escriu les idees, dades i condicions importants…",
  },
  improve: {
    heading: "Què vols millorar?",
    sourceLabel: "Versió actual",
    sourcePlaceholder: "Enganxa aquí el contingut actual…",
    goalLabel: "Com hauria de quedar?",
    goalPlaceholder: "Ex.: més breu, més clar i amb un to professional",
  },
  summarize: {
    heading: "Què vols resumir?",
    sourceLabel: "Contingut original",
    sourcePlaceholder: "Enganxa el text o descriu la informació que cal resumir…",
    goalLabel: "Per a qui és i quina llargada vols?",
    goalPlaceholder: "Ex.: per a direcció, màxim cinc punts",
  },
  compare: {
    heading: "Quines opcions vols comparar?",
    sourceLabel: "Primera opció",
    sourcePlaceholder: "Descriu l’opció A…",
    secondLabel: "Segona opció",
    secondPlaceholder: "Descriu l’opció B…",
    goalLabel: "Què és més important per decidir?",
    goalPlaceholder: "Ex.: cost, temps, risc i facilitat d’ús",
  },
};

function buildPrompt(action: GuidedAction, source: string, second: string, goal: string, projectName: string) {
  const instruction = {
    analyze: "Analitza la informació, separa observacions de conclusions, identifica riscos i oportunitats i acaba amb següents passos concrets.",
    create: "Crea el resultat demanat en una versió completa, clara i llesta per revisar. Si falta una dada imprescindible, fes una sola pregunta concreta abans de continuar.",
    improve: "Millora el contingut mantenint-ne el significat. Retorna primer la versió final i després explica breument els canvis importants.",
    summarize: "Resumeix la informació per al destinatari indicat. Prioritza decisions, dates, riscos i accions; elimina repeticions.",
    compare: "Compara les dues opcions amb els criteris indicats. Utilitza una taula entenedora i acaba amb una recomanació, incloent els condicionants.",
  }[action.id];
  return [
    `Acció guiada: ${action.label}.`,
    `Projecte: ${projectName}.`,
    instruction,
    `Informació principal:\n${source.trim()}`,
    ...(second.trim() ? [`Segona opció:\n${second.trim()}`] : []),
    `Objectiu i criteris:\n${goal.trim()}`,
    "Escriu el resultat en llenguatge natural, sense terminologia tècnica innecessària.",
  ].join("\n\n");
}

export function GuidedActions({
  projectName,
  projectId,
  onCancel,
  onWriteDirectly,
  onStart,
}: {
  projectName: string;
  projectId: string | null;
  onCancel?: () => void;
  onWriteDirectly?: () => void;
  onStart: (prompt: string, summary: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<GuidedActionId | null>(null);
  const [source, setSource] = useState("");
  const [second, setSecond] = useState("");
  const [goal, setGoal] = useState("");
  const [savedTemplates, setSavedTemplates] = useState<ProjectTemplate[]>([]);
  const selected = useMemo(() => actions.find((action) => action.id === selectedId) ?? null, [selectedId]);
  const formCopy = selected ? copy[selected.id] : null;
  const ready = Boolean(selected && source.trim() && goal.trim() && (selected.id !== "compare" || second.trim()));
  const storageKey = projectId ? `aibrain.project.${projectId}.guided-templates.v1` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(parsed)) {
        setSavedTemplates(parsed.filter((item): item is ProjectTemplate => Boolean(item && typeof item === "object" && "label" in item && "detail" in item && "action" in item && "goal" in item)).slice(0, 12));
      }
    } catch {
      setSavedTemplates([]);
    }
  }, [storageKey]);

  const saveCurrentTemplate = () => {
    if (!selected || !goal.trim() || !storageKey) return;
    const template: ProjectTemplate = {
      label: `${selected.label}: ${goal.trim().slice(0, 42)}${goal.trim().length > 42 ? "…" : ""}`,
      detail: `Plantilla desada a ${projectName}`,
      action: selected.id,
      goal: goal.trim(),
    };
    const next = [template, ...savedTemplates.filter((item) => item.label !== template.label)].slice(0, 12);
    setSavedTemplates(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const selectTemplate = (template: ProjectTemplate) => {
    setSelectedId(template.action);
    setSource("");
    setSecond("");
    setGoal(template.goal);
  };

  if (!selected || !formCopy) {
    return (
      <section className="mx-auto flex min-h-full w-full max-w-[860px] flex-col justify-center px-5 py-10 md:px-10">
        {onCancel ? <button type="button" className="mb-7 flex w-fit items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] font-medium text-[#77736d] hover:bg-[#efeeeb]" onClick={onCancel}><ArrowLeft size={12} /> Torna a la conversa</button> : null}
        <h1 className="max-w-2xl text-balance text-[32px] font-semibold leading-[1.05] tracking-[-.04em] text-[#252321] md:text-[42px]">Què vols aconseguir?</h1>
        <p className="mt-4 max-w-[62ch] text-[14px] leading-6 text-[#77746f]">Tria una acció. Et demanarem només la informació necessària i prepararem la feina dins de {projectName}.</p>
        {onWriteDirectly ? <button type="button" className="mt-4 w-fit rounded-lg px-2 py-2 text-[12px] font-medium text-[#66625d] underline decoration-[#c8c4bd] underline-offset-4" onClick={onWriteDirectly}>Prefereixo escriure directament</button> : null}
        <div className="mt-8">
          <p className="text-[12px] font-semibold text-[#625f5a]">Plantilles ràpides de {projectName}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {[...savedTemplates, ...projectTemplates].map((template) => (
              <button key={template.label} type="button" className="rounded-xl border border-[#dfddd8] bg-white p-4 text-left transition hover:border-[#c8c4bd] hover:bg-[#f8f7f4]" onClick={() => selectTemplate(template)}>
                <span className="block text-[13px] font-semibold text-[#3b3834]">{template.label}</span>
                <span className="mt-1.5 block text-[12px] leading-5 text-[#85817a]">{template.detail}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-9 overflow-hidden rounded-2xl border border-[#deddd8] bg-white divide-y divide-[#e4e2dd]">
          {actions.map((action) => {
            const Icon = action.icon;
            return <button type="button" key={action.id} className="group flex w-full items-center gap-4 bg-[#fefefd] px-5 py-4 text-left transition hover:bg-[#f5f4f1] focus-visible:z-10 md:px-6" onClick={() => setSelectedId(action.id)}><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eeede9] text-[#504d48] transition group-hover:bg-[var(--brain-accent-soft)] group-hover:text-[var(--brain-accent)]"><Icon size={16} /></span><span className="min-w-0 flex-1 md:grid md:grid-cols-[130px_1fr] md:items-center md:gap-5"><span className="text-[14px] font-semibold text-[#34312d]">{action.label}</span><span><span className="block text-[12px] leading-5 text-[#77736d]">{action.detail}</span><span className="mt-1 block text-[11px] leading-4 text-[#99958e]">{action.result}</span></span></span><ArrowRight size={15} className="shrink-0 text-[#aaa69f] transition group-hover:translate-x-1 group-hover:text-[#55514c]" /></button>;
          })}
        </div>
      </section>
    );
  }
  const SelectedIcon = selected.icon;

  return (
    <section className="mx-auto w-full max-w-[760px] px-5 py-8 md:px-8 md:py-12">
      <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-medium text-[#77736d] hover:bg-[#efeeeb]" onClick={() => setSelectedId(null)}><ArrowLeft size={12} /> Canvia d’acció</button>
      <div className="mt-7 flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--brain-accent-soft)] text-[var(--brain-accent)]"><SelectedIcon size={18} /></span><div><h2 className="text-[30px] font-semibold tracking-[-.035em] text-[#292725]">{formCopy.heading}</h2><p className="mt-2 text-[12px] leading-5 text-[#817d76]">Plantilla “{selected.label}” per al projecte {projectName}.</p></div></div>
      <div className="mt-8 space-y-6">
        <label className="block"><span className="mb-2 block text-[12px] font-semibold text-[#625f5a]">{formCopy.sourceLabel}</span><textarea rows={selected.id === "create" ? 2 : 5} maxLength={12_000} value={source} onChange={(event) => setSource(event.target.value)} placeholder={formCopy.sourcePlaceholder} className="w-full resize-y rounded-xl border border-[#d8d6d1] bg-white px-4 py-3 text-[14px] leading-6 outline-none transition placeholder:text-[#aaa69f] focus:border-[#8e8a83]" /></label>
        {formCopy.secondLabel ? <label className="block"><span className="mb-2 block text-[12px] font-semibold text-[#625f5a]">{formCopy.secondLabel}</span><textarea rows={4} maxLength={8_000} value={second} onChange={(event) => setSecond(event.target.value)} placeholder={formCopy.secondPlaceholder} className="w-full resize-y rounded-xl border border-[#d8d6d1] bg-white px-4 py-3 text-[14px] leading-6 outline-none transition placeholder:text-[#aaa69f] focus:border-[#8e8a83]" /></label> : null}
        <label className="block"><span className="mb-2 block text-[12px] font-semibold text-[#625f5a]">{formCopy.goalLabel}</span><textarea rows={3} maxLength={2_000} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder={formCopy.goalPlaceholder} className="w-full resize-y rounded-xl border border-[#d8d6d1] bg-white px-4 py-3 text-[14px] leading-6 outline-none transition placeholder:text-[#aaa69f] focus:border-[#8e8a83]" /></label>
      </div>
      <div className="mt-7 flex flex-col gap-4 border-t border-[#e1dfda] pt-6 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 items-start gap-2 text-[12px] leading-5 text-[#817d76]"><CheckCircle size={14} className="mt-0.5 shrink-0 text-[#617b66]" />{selected.result}. Podràs revisar-lo abans d’utilitzar-lo.</div><div className="flex flex-col gap-2 sm:flex-row"><button type="button" disabled={!goal.trim() || !storageKey} className="rounded-xl border border-[#d8d6d1] bg-white px-4 py-3 text-[12px] font-semibold text-[#625f5a] disabled:opacity-40" onClick={saveCurrentTemplate}>Desa al projecte</button><button type="button" disabled={!ready} className="flex items-center justify-center gap-2 rounded-xl bg-[var(--brain-accent)] px-5 py-3 text-[13px] font-semibold text-[var(--brain-contrast)] transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-35" onClick={() => ready && onStart(buildPrompt(selected, source, second, goal, projectName), `${selected.label}: ${goal.trim()}`)}>Comença <ArrowRight size={13} /></button></div></div>
    </section>
  );
}
