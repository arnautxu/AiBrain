"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ChatCircleDots,
  Command,
  Folder,
  ListChecks,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import type { WorkbenchProject, WorkbenchThread } from "@/workbench/types";

type PaletteItem = {
  id: string;
  group: "Accions" | "Projectes" | "Fils";
  label: string;
  detail: string;
  icon: ReactNode;
  keywords: string;
  shortcut?: string;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  busy: boolean;
  projects: WorkbenchProject[];
  threads: WorkbenchThread[];
  activeProjectId: string | null;
  inspectorEnabled: boolean;
  onClose: () => void;
  onNewThread: () => void;
  onNewProject: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onOpenInspector: () => void;
  onOpenCustomization: () => void;
};

function searchable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ca");
}

export function CommandPalette({
  open,
  busy,
  projects,
  threads,
  activeProjectId,
  inspectorEnabled,
  onClose,
  onNewThread,
  onNewProject,
  onSelectProject,
  onSelectThread,
  onOpenInspector,
  onOpenCustomization,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const activeProjects = projects.filter((project) => project.status === "active");
    const projectNames = new Map(activeProjects.map((project) => [project.id, project.name]));
    const actions: PaletteItem[] = [
      ...(activeProjectId ? [{
        id: "action:new-thread",
        group: "Accions" as const,
        label: "Nou fil",
        detail: projectNames.get(activeProjectId) ?? "Projecte actiu",
        icon: <Plus size={16} />,
        keywords: "nou fil conversa thread",
        shortcut: "⌘N",
        run: onNewThread,
      }] : []),
      {
        id: "action:new-project",
        group: "Accions",
        label: "Nou projecte",
        detail: "Crea un espai de treball",
        icon: <Folder size={16} />,
        keywords: "nou projecte carpeta workspace",
        shortcut: "⌘⇧P",
        run: onNewProject,
      },
      ...(inspectorEnabled ? [{
        id: "action:inspector",
        group: "Accions" as const,
        label: "Obre Review",
        detail: "Canvis, activitat i aprovacions del torn",
        icon: <ListChecks size={16} />,
        keywords: "review inspector canvis diff activitat aprovacions",
        run: onOpenInspector,
      }] : []),
      {
        id: "action:customize",
        group: "Accions",
        label: "Personalitza el workbench",
        detail: "Identitat, densitat i superfícies",
        icon: <SlidersHorizontal size={16} />,
        keywords: "personalitza configuracio tema densitat interfície",
        run: onOpenCustomization,
      },
    ];
    const projectItems: PaletteItem[] = activeProjects.map((project) => ({
      id: `project:${project.id}`,
      group: "Projectes",
      label: project.name,
      detail: project.workspace.label,
      icon: <Folder size={16} weight={project.id === activeProjectId ? "fill" : "regular"} />,
      keywords: `projecte ${project.name} ${project.workspace.label}`,
      run: () => onSelectProject(project.id),
    }));
    const threadItems: PaletteItem[] = threads
      .filter((thread) => thread.status === "active" && projectNames.has(thread.projectId))
      .map((thread) => ({
        id: `thread:${thread.id}`,
        group: "Fils",
        label: thread.title,
        detail: projectNames.get(thread.projectId) ?? "Projecte",
        icon: <ChatCircleDots size={16} />,
        keywords: `fil conversa ${thread.title} ${projectNames.get(thread.projectId) ?? ""}`,
        run: () => onSelectThread(thread.id),
      }));
    return [...actions, ...projectItems, ...threadItems];
  }, [
    activeProjectId,
    inspectorEnabled,
    onNewProject,
    onNewThread,
    onOpenCustomization,
    onOpenInspector,
    onSelectProject,
    onSelectThread,
    projects,
    threads,
  ]);

  const visibleItems = useMemo(() => {
    const normalized = searchable(query.trim());
    if (!normalized) return items;
    return items.filter((item) => searchable(`${item.label} ${item.detail} ${item.keywords}`).includes(normalized));
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;
  const visibleActiveIndex = Math.min(activeIndex, Math.max(visibleItems.length - 1, 0));

  const run = (item: PaletteItem) => {
    if (busy && item.id.startsWith("action:new")) return;
    item.run();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-[#151513]/25 px-3 pt-[10vh] backdrop-blur-[3px] sm:px-6 sm:pt-[13vh]">
      <button aria-label="Tancar ordres" className="absolute inset-0" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Cerca i ordres"
        className="palette-enter relative flex max-h-[min(620px,76vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-[18px] border border-[#cfcdc7] bg-[#fbfbfa] shadow-[0_30px_90px_-28px_rgba(31,29,25,.52)]"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => visibleItems.length ? (current + 1) % visibleItems.length : 0);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => visibleItems.length ? (current - 1 + visibleItems.length) % visibleItems.length : 0);
          } else if (event.key === "Enter" && visibleItems[visibleActiveIndex]) {
            event.preventDefault();
            run(visibleItems[visibleActiveIndex]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="command-palette-search flex h-14 shrink-0 items-center gap-3 border-b border-[#e2e0db] px-4 transition-colors">
          <MagnifyingGlass size={18} className="shrink-0 text-[#77736d]" />
          <input
            ref={inputRef}
            aria-label="Cerca projectes, fils i ordres"
            className="command-palette-input min-w-0 flex-1 bg-transparent text-[14px] text-[#292724] outline-none placeholder:text-[#99958e]"
            placeholder="Cerca projectes, fils o ordres…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
          <span className="hidden items-center gap-1 rounded-md border border-[#d9d7d1] bg-[#f3f2ef] px-1.5 py-1 text-[9px] font-medium text-[#77736d] sm:flex">esc</span>
        </div>

        <div role="listbox" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
          {visibleItems.length ? visibleItems.map((item, index) => {
            const previousGroup = visibleItems[index - 1]?.group;
            const selected = index === visibleActiveIndex;
            const disabled = busy && item.id.startsWith("action:new");
            return (
              <div key={item.id}>
                {item.group !== previousGroup ? (
                  <p className="px-2.5 pb-1.5 pt-3 text-[9px] font-semibold tracking-[0.02em] text-[#99958e] first:pt-1.5">{item.group}</p>
                ) : null}
                <button
                  role="option"
                  aria-selected={selected}
                  disabled={disabled}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${selected ? "bg-[#e9e8e4] text-[#282623]" : "text-[#5e5a55] hover:bg-[#f0efec]"} disabled:opacity-40`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(item)}
                >
                  <span className={`grid size-8 shrink-0 place-items-center rounded-[9px] border ${selected ? "border-[#d2d0ca] bg-[#f8f8f6] text-[#34312d]" : "border-[#e2e0db] bg-white text-[#77736d]"}`}>{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-[#918d86]">{item.detail}</span>
                  </span>
                  {item.shortcut ? <span className="text-[9px] font-medium text-[#99958e]">{item.shortcut}</span> : <ArrowRight size={13} className={`text-[#a29e97] transition ${selected ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0"}`} />}
                </button>
              </div>
            );
          }) : (
            <div className="grid min-h-44 place-items-center px-6 text-center">
              <div>
                <span className="mx-auto grid size-9 place-items-center rounded-xl bg-[#f0efec] text-[#77736d]"><Command size={17} /></span>
                <p className="mt-3 text-[11px] font-semibold text-[#4b4843]">Cap resultat</p>
                <p className="mt-1 text-[9px] text-[#918d86]">Prova amb el nom d’un projecte, un fil o una ordre.</p>
              </div>
            </div>
          )}
        </div>

        <footer className="flex h-9 shrink-0 items-center justify-between border-t border-[#e2e0db] bg-[#f6f5f2] px-4 text-[8px] text-[#918d86]">
          <span className="flex items-center gap-2"><span>↑↓ navega</span><span>↵ obre</span></span>
          <span className="flex items-center gap-1"><Command size={10} /> K</span>
        </footer>
      </section>
    </div>
  );
}
