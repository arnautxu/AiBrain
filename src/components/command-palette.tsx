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
import { useModalFocus } from "@/ui/use-modal-focus";

type PaletteItem = {
  id: string;
  group: "Acciones" | "Proyectos" | "Conversaciones";
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
  const dialogRef = useModalFocus(open, onClose, inputRef);

  const items = useMemo<PaletteItem[]>(() => {
    const activeProjects = projects.filter((project) => project.status === "active");
    const projectNames = new Map(activeProjects.map((project) => [project.id, project.name]));
    const actions: PaletteItem[] = [
      ...(activeProjectId ? [{
        id: "action:new-thread",
        group: "Acciones" as const,
        label: "Nueva conversación",
        detail: projectNames.get(activeProjectId) ?? "Proyecto activo",
        icon: <Plus size={16} />,
        keywords: "nou fil conversa thread",
        shortcut: "⌘N",
        run: onNewThread,
      }] : []),
      {
        id: "action:new-project",
        group: "Acciones",
        label: "Nuevo proyecto",
        detail: "Organiza conversaciones y resultados",
        icon: <Folder size={16} />,
        keywords: "nou projecte carpeta workspace",
        shortcut: "⌘⇧P",
        run: onNewProject,
      },
      ...(inspectorEnabled ? [{
        id: "action:inspector",
        group: "Acciones" as const,
        label: "Abrir Review",
        detail: "Progreso, decisiones y cambios del resultado",
        icon: <ListChecks size={16} />,
        keywords: "review inspector canvis diff activitat aprovacions",
        run: onOpenInspector,
      }] : []),
      {
        id: "action:customize",
        group: "Acciones",
        label: "Abrir preferencias",
        detail: "Respuesta, densidad y conversación",
        icon: <SlidersHorizontal size={16} />,
        keywords: "personalitza configuracio tema densitat interfície",
        run: onOpenCustomization,
      },
    ];
    const projectItems: PaletteItem[] = activeProjects.map((project) => ({
      id: `project:${project.id}`,
      group: "Proyectos",
      label: project.name,
      detail: "Proyecto",
      icon: <Folder size={16} weight={project.id === activeProjectId ? "fill" : "regular"} />,
      keywords: `projecte ${project.name} ${project.workspace.label}`,
      run: () => onSelectProject(project.id),
    }));
    const threadItems: PaletteItem[] = threads
      .filter((thread) => thread.status === "active" && projectNames.has(thread.projectId))
      .map((thread) => ({
        id: `thread:${thread.id}`,
        group: "Conversaciones",
        label: thread.title,
        detail: projectNames.get(thread.projectId) ?? "Proyecto",
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
    <div className="fixed inset-0 z-[80] flex justify-center bg-[var(--overlay)] px-3 pt-[10vh] backdrop-blur-[3px] sm:px-6 sm:pt-[13vh]">
      <button aria-label="Cerrar búsqueda" className="absolute inset-0" onClick={onClose} />
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar proyectos y conversaciones"
        className="palette-enter relative flex max-h-[min(620px,76vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]"
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
        <div className="command-palette-search flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 transition-colors">
          <MagnifyingGlass size={18} className="shrink-0 text-[var(--text-subtle)]" />
          <input
            ref={inputRef}
            aria-label="Buscar proyectos, conversaciones y acciones"
            className="command-palette-input min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]"
            placeholder="Busca proyectos, conversaciones o acciones…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
          <span className="hidden items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-1 text-[9px] font-medium text-[var(--text-secondary)] sm:flex">esc</span>
        </div>

        <div role="listbox" aria-label="Resultados de búsqueda" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
          {visibleItems.length ? visibleItems.map((item, index) => {
            const previousGroup = visibleItems[index - 1]?.group;
            const selected = index === visibleActiveIndex;
            const disabled = busy && item.id.startsWith("action:new");
            return (
              <div key={item.id}>
                {item.group !== previousGroup ? (
                  <p className="px-2.5 pb-1.5 pt-3 text-[10px] font-semibold tracking-[0.02em] text-[var(--text-secondary)] first:pt-1.5">{item.group}</p>
                ) : null}
                <button
                  role="option"
                  aria-selected={selected}
                  disabled={disabled}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${selected ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"} disabled:opacity-40`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(item)}
                >
                  <span className={`grid size-8 shrink-0 place-items-center rounded-[9px] border ${selected ? "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-subtle)]"}`}>{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--text-secondary)]">{item.detail}</span>
                  </span>
                  {item.shortcut ? <span className="text-[9px] font-medium text-[var(--text-secondary)]">{item.shortcut}</span> : <ArrowRight size={13} className={`text-[var(--text-secondary)] transition ${selected ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0"}`} />}
                </button>
              </div>
            );
          }) : (
            <div className="grid min-h-44 place-items-center px-6 text-center">
              <div>
                <span className="mx-auto grid size-9 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--text-subtle)]"><Command size={17} /></span>
                <p className="mt-3 text-[12px] font-semibold text-[var(--text)]">Sin resultados</p>
                <p className="mt-1 text-[10px] text-[var(--text-subtle)]">Prueba con el nombre de un proyecto, una conversación o una acción.</p>
              </div>
            </div>
          )}
        </div>

        <footer className="flex h-9 shrink-0 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--surface-muted)] px-4 text-[9px] text-[var(--text-secondary)]">
          <span className="flex items-center gap-2"><span>↑↓ navegar</span><span>↵ abrir</span></span>
          <span className="flex items-center gap-1"><Command size={10} /> K</span>
        </footer>
      </section>
    </div>
  );
}
