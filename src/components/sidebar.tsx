"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  CaretDown,
  CaretRight,
  ChatCircleDots,
  DotsThree,
  Folder,
  FolderOpen,
  GearSix,
  MagnifyingGlass,
  NotePencil,
  Plus,
  PushPin,
  SidebarSimple,
  SignOut,
  UserCircle,
  X,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import type { AuthSession } from "@/auth/types";
import { BrandMark, ThemeToggle } from "@/components/ui/primitives";
import type { PublicInstallationBranding } from "@/config/installation-branding";
import type { WorkbenchProject, WorkbenchThread } from "@/workbench/types";
import { useModalFocus } from "@/ui/use-modal-focus";

export type ProjectMenuAction = "rename" | "pin" | "unpin" | "archive" | "restore";
export type ThreadMenuAction = "rename" | "pin" | "unpin" | "archive" | "restore";

type SidebarProps = {
  branding: Readonly<PublicInstallationBranding>;
  session: AuthSession;
  projects: WorkbenchProject[];
  threads: WorkbenchThread[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  mobileOpen: boolean;
  desktopOpen: boolean;
  busy: boolean;
  onCloseMobile: () => void;
  onCloseDesktop: () => void;
  onOpenCommandPalette: () => void;
  onSelectProject: (id: string) => void;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onNewProject: () => void;
  onProjectAction: (project: WorkbenchProject, action: ProjectMenuAction) => void;
  onThreadAction: (thread: WorkbenchThread, action: ThreadMenuAction) => void;
  onOpenCustomization: () => void;
};

function relativeDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  const difference = Date.now() - parsed.getTime();
  if (difference < 86_400_000) return "Hoy";
  if (difference < 172_800_000) return "Ayer";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(parsed);
}

function byPriority<Item extends { pinned: boolean; updatedAt: string }>(a: Item, b: Item) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function MenuButton({ icon, label, danger = false, onClick }: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition hover:bg-[var(--surface-hover)] ${danger ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}`}
      onClick={onClick}
    >
      {icon}{label}
    </button>
  );
}

function ItemActions({ kind, item, onAction }: {
  kind: "project" | "thread";
  item: WorkbenchProject | WorkbenchThread;
  onAction: (action: ProjectMenuAction | ThreadMenuAction) => void;
}) {
  return (
    <div role="menu" className="absolute right-1 top-8 z-20 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1 shadow-[var(--shadow-lg)]">
      {item.status === "active" ? (
        <>
          <MenuButton icon={<NotePencil size={14} />} label="Renombrar" onClick={() => onAction("rename")} />
          <MenuButton icon={<PushPin size={14} />} label={item.pinned ? "Desfijar" : "Fijar"} onClick={() => onAction(item.pinned ? "unpin" : "pin")} />
          <MenuButton danger icon={<Archive size={14} />} label="Archivar" onClick={() => onAction("archive")} />
        </>
      ) : (
        <MenuButton icon={kind === "project" ? <FolderOpen size={14} /> : <ChatCircleDots size={14} />} label="Restaurar" onClick={() => onAction("restore")} />
      )}
    </div>
  );
}

export function Sidebar({
  branding,
  session,
  projects,
  threads,
  activeProjectId,
  activeThreadId,
  mobileOpen,
  desktopOpen,
  busy,
  onCloseMobile,
  onCloseDesktop,
  onOpenCommandPalette,
  onSelectProject,
  onSelectThread,
  onNewThread,
  onNewProject,
  onProjectAction,
  onThreadAction,
  onOpenCustomization,
}: SidebarProps) {
  const router = useRouter();
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [archivedProjectsOpen, setArchivedProjectsOpen] = useState(false);
  const [archivedThreadsOpen, setArchivedThreadsOpen] = useState(false);
  const sidebarRef = useModalFocus(mobileOpen, onCloseMobile);
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "active").sort(byPriority),
    [projects],
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => project.status === "archived").sort(byPriority),
    [projects],
  );
  const projectThreads = useMemo(
    () => threads.filter((thread) => thread.projectId === activeProjectId).sort(byPriority),
    [activeProjectId, threads],
  );
  const activeThreads = projectThreads.filter((thread) => thread.status === "active");
  const archivedThreads = projectThreads.filter((thread) => thread.status === "archived");
  const activeProject = activeProjects.find((project) => project.id === activeProjectId) ?? null;

  const closeMenus = () => {
    setProjectMenuId(null);
    setThreadMenuId(null);
  };
  const selectProject = (id: string) => {
    closeMenus();
    onSelectProject(id);
    onCloseMobile();
  };
  const selectThread = (id: string) => {
    closeMenus();
    onSelectThread(id);
    onCloseMobile();
  };

  return (
    <>
      {mobileOpen ? <button aria-label="Cerrar barra lateral" className="fixed inset-0 z-30 bg-black/25 backdrop-blur-[2px] md:hidden" onClick={onCloseMobile} /> : null}
      <aside
        ref={sidebarRef}
        tabIndex={mobileOpen ? -1 : undefined}
        aria-modal={mobileOpen ? "true" : undefined}
        role={mobileOpen ? "dialog" : undefined}
        aria-label={mobileOpen ? "Navegación" : undefined}
        data-testid="workbench-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-[min(280px,88vw)] flex-col border-r border-[var(--border-subtle)] bg-[var(--sidebar)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] transition-[transform,visibility] duration-200 md:static md:w-[260px] md:translate-x-0 md:pb-0 md:pt-0 ${desktopOpen ? "md:flex" : "md:hidden"} ${mobileOpen ? "visible translate-x-0 pointer-events-auto" : "invisible -translate-x-full pointer-events-none md:visible md:pointer-events-auto"}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-3">
          <BrandMark branding={branding} />
          <button aria-label="Ocultar barra lateral" className="touch-target hidden rounded-lg p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] md:block" onClick={onCloseDesktop}><SidebarSimple size={18} /></button>
          <button aria-label="Cerrar menú" className="touch-target rounded-lg p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-hover)] md:hidden" onClick={onCloseMobile}><X size={18} /></button>
        </div>

        <nav aria-label="Navegación principal" className="space-y-1 px-2 pb-3">
          <button disabled={!activeProject || busy} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-hover)] disabled:opacity-40" onClick={onNewThread}>
            <NotePencil size={17} /> Nueva conversación
          </button>
          <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onOpenCommandPalette}>
            <MagnifyingGlass size={17} />
            <span className="min-w-0 flex-1 text-[13px]">Buscar</span>
            <kbd className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-subtle)]">⌘K</kbd>
          </button>
        </nav>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <section aria-labelledby="projects-label">
            <div className="flex items-center justify-between px-3 pb-1 pt-2">
              <h2 id="projects-label" className="text-[11px] font-semibold text-[var(--text-subtle)]">Proyectos</h2>
              <button aria-label="Crear proyecto" className="rounded-md p-1 text-[var(--text-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onNewProject}><Plus size={14} /></button>
            </div>
            <div className="space-y-0.5">
              {activeProjects.length === 0 ? (
                <button className="w-full rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-left text-[12px] leading-5 text-[var(--text-subtle)]" onClick={onNewProject}>Crea tu primer proyecto</button>
              ) : activeProjects.map((project) => {
                const active = project.id === activeProjectId;
                const menuOpen = projectMenuId === project.id;
                return (
                  <div key={project.id} className="relative group">
                    <button aria-current={active ? "page" : undefined} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 pr-9 text-left transition ${active ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"}`} onClick={() => selectProject(project.id)}>
                      {active ? <FolderOpen size={16} weight="fill" /> : <Folder size={16} />}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{project.name}</span>
                      {project.pinned ? <PushPin size={11} weight="fill" className="text-[var(--text-subtle)]" /> : null}
                    </button>
                    <button aria-label={`Acciones de ${project.name}`} aria-expanded={menuOpen} className="absolute right-1 top-1 rounded-md p-2 text-[var(--text-subtle)] opacity-0 hover:bg-[var(--surface-selected)] group-hover:opacity-100 focus:opacity-100" onClick={() => { setThreadMenuId(null); setProjectMenuId(menuOpen ? null : project.id); }}><DotsThree size={15} weight="bold" /></button>
                    {menuOpen ? <ItemActions kind="project" item={project} onAction={(action) => { closeMenus(); onProjectAction(project, action as ProjectMenuAction); }} /> : null}
                  </div>
                );
              })}
            </div>
          </section>

          {activeProject ? (
            <section aria-labelledby="conversations-label" className="mt-5">
              <div className="flex items-center justify-between px-3 pb-1">
                <h2 id="conversations-label" className="truncate text-[11px] font-semibold text-[var(--text-subtle)]">Conversaciones</h2>
                <button disabled={busy} aria-label="Nueva conversación" className="rounded-md p-1 text-[var(--text-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40" onClick={onNewThread}><Plus size={14} /></button>
              </div>
              <div className="space-y-0.5">
                {activeThreads.length === 0 ? <p className="px-3 py-2 text-[12px] leading-5 text-[var(--text-subtle)]">Aún no hay conversaciones.</p> : activeThreads.map((thread) => {
                  const active = thread.id === activeThreadId;
                  const menuOpen = threadMenuId === thread.id;
                  return (
                    <div key={thread.id} className="relative group/thread">
                      <button aria-current={active ? "page" : undefined} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 pr-9 text-left transition ${active ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"}`} onClick={() => selectThread(thread.id)}>
                        <ChatCircleDots size={15} weight={active ? "fill" : "regular"} />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{thread.title}</span>
                        {thread.pinned ? <PushPin size={10} weight="fill" /> : <span className="text-[9px] text-[var(--text-subtle)] opacity-0 group-hover/thread:opacity-100">{relativeDate(thread.updatedAt)}</span>}
                      </button>
                      <button aria-label={`Acciones de ${thread.title}`} aria-expanded={menuOpen} className="absolute right-1 top-1 rounded-md p-2 text-[var(--text-subtle)] opacity-0 hover:bg-[var(--surface-selected)] group-hover/thread:opacity-100 focus:opacity-100" onClick={() => { setProjectMenuId(null); setThreadMenuId(menuOpen ? null : thread.id); }}><DotsThree size={14} weight="bold" /></button>
                      {menuOpen ? <ItemActions kind="thread" item={thread} onAction={(action) => { closeMenus(); onThreadAction(thread, action as ThreadMenuAction); }} /> : null}
                    </div>
                  );
                })}
              </div>
              {archivedThreads.length ? (
                <div className="mt-1">
                  <button className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium text-[var(--text-subtle)] hover:bg-[var(--surface-hover)]" onClick={() => setArchivedThreadsOpen((open) => !open)}>{archivedThreadsOpen ? <CaretDown size={12} /> : <CaretRight size={12} />} Archivadas · {archivedThreads.length}</button>
                  {archivedThreadsOpen ? archivedThreads.map((thread) => <div key={thread.id} className="relative group/thread flex items-center gap-2 rounded-lg px-3 py-2 pr-9 text-[var(--text-subtle)]"><Archive size={13} /><span className="truncate text-[11px]">{thread.title}</span><button aria-label={`Acciones de ${thread.title}`} className="absolute right-1 rounded-md p-2 opacity-0 group-hover/thread:opacity-100 focus:opacity-100" onClick={() => setThreadMenuId(threadMenuId === thread.id ? null : thread.id)}><DotsThree size={14} /></button>{threadMenuId === thread.id ? <ItemActions kind="thread" item={thread} onAction={(action) => { closeMenus(); onThreadAction(thread, action as ThreadMenuAction); }} /> : null}</div>) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {archivedProjects.length ? (
            <section className="mt-4">
              <button className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium text-[var(--text-subtle)] hover:bg-[var(--surface-hover)]" onClick={() => setArchivedProjectsOpen((open) => !open)}>{archivedProjectsOpen ? <CaretDown size={12} /> : <CaretRight size={12} />} Proyectos archivados · {archivedProjects.length}</button>
              {archivedProjectsOpen ? archivedProjects.map((project) => <div key={project.id} className="relative group flex items-center gap-2 rounded-lg px-3 py-2 pr-9 text-[var(--text-subtle)]"><Archive size={13} /><span className="truncate text-[11px]">{project.name}</span><button aria-label={`Acciones de ${project.name}`} className="absolute right-1 rounded-md p-2 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setProjectMenuId(projectMenuId === project.id ? null : project.id)}><DotsThree size={14} /></button>{projectMenuId === project.id ? <ItemActions kind="project" item={project} onAction={(action) => { closeMenus(); onProjectAction(project, action as ProjectMenuAction); }} /> : null}</div>) : null}
            </section>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-[var(--border-subtle)] p-2">
          <div className="mb-1 flex items-center gap-1">
            <button className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onOpenCustomization}>
              <GearSix size={16} /><span className="truncate text-[12px] font-medium">Preferencias</span>
            </button>
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-hover)]">
            <UserCircle size={20} className="shrink-0 text-[var(--text-subtle)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[var(--text)]">{session.user.name}</p>
              <p className="mt-0.5 truncate text-[10px] text-[var(--text-subtle)]">{branding.companyName}</p>
            </div>
            <button aria-label="Cerrar sesión" className="touch-target rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-selected)] hover:text-[var(--text)]" onClick={() => void fetch("/api/auth/logout", { method: "POST" }).then((response) => { if (response.ok) router.push("/login"); })}><SignOut size={15} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
