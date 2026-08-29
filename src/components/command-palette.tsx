"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatCircleDots, Command, Folder, MagnifyingGlass } from "@phosphor-icons/react";
import type { WorkbenchProject, WorkbenchThread } from "@/workbench/types";
import { useModalFocus } from "@/ui/use-modal-focus";

type SearchItem = { id: string; group: "Proyectos" | "Conversaciones"; label: string; detail: string; keywords: string; run: () => void };
type CommandPaletteProps = { open: boolean; projects: WorkbenchProject[]; threads: WorkbenchThread[]; activeProjectId: string | null; onClose: () => void; onSelectProject: (projectId: string) => void; onSelectThread: (threadId: string) => void };

function searchable(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("ca"); }

/** Deliberately limited to navigation: project and chat names only. */
export function CommandPalette({ open, projects, threads, activeProjectId, onClose, onSelectProject, onSelectThread }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalFocus(open, onClose, inputRef);
  const items = useMemo<SearchItem[]>(() => {
    const activeProjects = projects.filter((project) => project.status === "active");
    const projectNames = new Map(activeProjects.map((project) => [project.id, project.name]));
    return [
      ...activeProjects.map((project) => ({ id: `project:${project.id}`, group: "Proyectos" as const, label: project.name, detail: "Proyecto", keywords: `${project.name} ${project.workspace.label}`, run: () => onSelectProject(project.id) })),
      ...threads.filter((thread) => thread.status === "active" && projectNames.has(thread.projectId)).map((thread) => ({ id: `thread:${thread.id}`, group: "Conversaciones" as const, label: thread.title, detail: projectNames.get(thread.projectId) ?? "Sin proyecto", keywords: `${thread.title} ${projectNames.get(thread.projectId) ?? ""}`, run: () => onSelectThread(thread.id) })),
    ];
  }, [onSelectProject, onSelectThread, projects, threads]);
  const visibleItems = useMemo(() => { const normalized = searchable(query.trim()); return normalized ? items.filter((item) => searchable(`${item.label} ${item.detail} ${item.keywords}`).includes(normalized)) : items; }, [items, query]);
  useEffect(() => { if (!open) return; const frame = requestAnimationFrame(() => { setQuery(""); setActiveIndex(0); inputRef.current?.focus(); }); return () => cancelAnimationFrame(frame); }, [open]);
  if (!open) return null;
  const visibleActiveIndex = Math.min(activeIndex, Math.max(visibleItems.length - 1, 0));
  const run = (item: SearchItem) => { item.run(); onClose(); };
  return <div className="fixed inset-0 z-[80] flex justify-center bg-black/15 px-3 pt-[8vh] backdrop-blur-[1px] sm:px-6 sm:pt-[11vh]">
    <button aria-label="Cerrar búsqueda" className="absolute inset-0" onClick={onClose} />
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Buscar proyectos y conversaciones" className="palette-enter relative flex max-h-[min(640px,80vh)] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] shadow-[var(--shadow-popover)]" onKeyDown={(event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => visibleItems.length ? (current + 1) % visibleItems.length : 0); }
      else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => visibleItems.length ? (current - 1 + visibleItems.length) % visibleItems.length : 0); }
      else if (event.key === "Enter" && visibleItems[visibleActiveIndex]) { event.preventDefault(); run(visibleItems[visibleActiveIndex]); }
      else if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }}>
      <div className="command-palette-search flex h-16 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-5 transition-colors"><MagnifyingGlass size={19} className="shrink-0 text-[var(--text-subtle)]" /><input ref={inputRef} aria-label="Buscar proyectos y conversaciones" className="command-palette-input min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]" placeholder="Busca proyectos o conversaciones…" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} /><span className="hidden items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] sm:flex">esc</span></div>
      <div role="listbox" aria-label="Resultados de búsqueda" className="scrollbar-thin min-h-0 overflow-y-auto p-2">{visibleItems.length ? visibleItems.map((item, index) => <button key={item.id} role="option" aria-selected={index === visibleActiveIndex} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${index === visibleActiveIndex ? "bg-[var(--surface-selected)]" : "hover:bg-[var(--surface-hover)]"}`} onMouseMove={() => setActiveIndex(index)} onClick={() => run(item)}><span className="grid size-7 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--text-subtle)]">{item.group === "Proyectos" ? <Folder size={15} weight={item.id === `project:${activeProjectId}` ? "fill" : "regular"} /> : <ChatCircleDots size={15} />}</span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-[var(--text)]">{item.label}</span><span className="block truncate text-[11px] text-[var(--text-subtle)]">{item.detail}</span></span></button>) : <p className="px-3 py-8 text-center text-[12px] text-[var(--text-subtle)]">No hay proyectos ni conversaciones que coincidan.</p>}</div>
      <footer className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-2 text-[10px] text-[var(--text-subtle)]"><Command size={12} />Solo se buscan proyectos y conversaciones.</footer>
    </section>
  </div>;
}
