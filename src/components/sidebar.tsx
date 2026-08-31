"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  CalendarBlank,
  CaretDown,
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  DotsThree,
  FolderOpen,
  GearSix,
  MagnifyingGlass,
  NotePencil,
  Plus,
  PushPin,
  Question,
  SidebarSimple,
  SignOut,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Folder as FluidFolder,
  FolderOpen as FluidFolderOpen,
  PenLine,
} from "lucide-react";
import type { AuthSession } from "@/auth/types";
import { BrandMark } from "@/components/ui/primitives";
import { UserAvatar } from "@/components/user-avatar";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { PublicInstallationBranding } from "@/config/installation-branding";
import {
  STANDALONE_PROJECT_SLUG,
  type WorkbenchProject,
  type WorkbenchThread,
} from "@/workbench/types";
import { useModalFocus } from "@/ui/use-modal-focus";
import type { ThreadActivity } from "@/workbench/thread-activity";

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
  threadActivityById: Record<string, ThreadActivity>;
  onCloseMobile: () => void;
  onCloseDesktop: () => void;
  onOpenDesktop: () => void;
  onOpenCommandPalette: () => void;
  onOpenAutomations: () => void;
  onSelectProject: (id: string) => void;
  onSelectThread: (id: string) => void;
  onNewThread: (projectId?: string) => void;
  onNewProject: () => void;
  onProjectAction: (project: WorkbenchProject, action: ProjectMenuAction) => void;
  onThreadAction: (thread: WorkbenchThread, action: ThreadMenuAction) => void;
  onOpenCustomization: () => void;
};

const threadStateCopy: Record<ThreadActivity["state"], string> = {
  idle: "Sin actividad pendiente",
  running: "Trabajando",
  needs_attention: "Necesita tu atención",
  completed: "Trabajo completado",
  failed: "La ejecución ha fallado",
};

function ThreadActivitySignal({ activity }: { activity: ThreadActivity | undefined }) {
  if (!activity || (activity.state === "idle" && activity.unreadCount === 0)) return null;
  const label = threadStateCopy[activity.state];
  return (
    <span className="flex shrink-0 items-center gap-1" title={label}>
      {activity.unreadCount > 0 ? <span aria-label="Hay actualizaciones sin leer" className="size-2 rounded-full bg-[var(--notification-accent)]" /> : null}
      <span aria-label={label} className={`grid size-4 place-items-center rounded-full ${
        activity.state === "needs_attention" || activity.state === "failed"
          ? "text-[var(--danger)]"
          : activity.state === "completed"
            ? "text-[var(--text-secondary)]"
            : "text-[var(--text-subtle)]"
      }`}>
        {activity.state === "running" ? <SpinnerGap size={13} className="motion-safe:animate-spin" /> : null}
        {activity.state === "needs_attention" || activity.state === "failed" ? <WarningCircle size={13} weight="fill" /> : null}
        {activity.state === "completed" ? <CheckCircle size={13} weight="fill" /> : null}
      </span>
    </span>
  );
}

function ProjectActivitySignal({ activities }: { activities: ThreadActivity[] }) {
  const running = activities.filter((activity) => activity.state === "running").length;
  const attention = activities.filter((activity) => activity.state === "needs_attention" || activity.state === "failed").length;
  const unread = activities.reduce((total, activity) => total + activity.unreadCount, 0);
  if (!running && !attention && !unread) return null;
  const label = attention
    ? `${attention} ${attention === 1 ? "conversación necesita" : "conversaciones necesitan"} atención`
    : running
      ? `${running} ${running === 1 ? "conversación trabajando" : "conversaciones trabajando"}`
      : `${unread} ${unread === 1 ? "actualización sin leer" : "actualizaciones sin leer"}`;
  return (
    <span aria-label={label} title={label} className="flex shrink-0 items-center gap-1 text-[var(--text-subtle)]">
      {attention ? <WarningCircle size={12} weight="fill" className="text-[var(--danger)]" /> : null}
      {!attention && running ? <SpinnerGap size={12} className="motion-safe:animate-spin" /> : null}
      {unread ? <span className="size-2 rounded-full bg-[var(--notification-accent)]" aria-label="Hay actualizaciones sin leer" /> : null}
    </span>
  );
}

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

function ItemActions({ kind, item, onAction, onClose }: {
  kind: "project" | "thread";
  item: WorkbenchProject | WorkbenchThread;
  onAction: (action: ProjectMenuAction | ThreadMenuAction) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [onClose]);

  const itemLabel = "name" in item ? item.name : item.title;
  return (
    <div ref={menuRef} role="menu" aria-label={`Acciones de ${itemLabel}`} className="menu-enter absolute right-1 top-8 z-50 w-56 rounded-[20px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-1.5 shadow-[var(--shadow-popover)]" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
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
  threadActivityById,
  onCloseMobile,
  onCloseDesktop,
  onOpenDesktop,
  onOpenCommandPalette,
  onOpenAutomations,
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<string[]>([]);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const railOpenButtonRef = useRef<HTMLButtonElement>(null);
  const desktopCloseButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useModalFocus(mobileOpen, onCloseMobile);
  const activeProjects = useMemo(
    () => projects.filter((project) =>
      project.status === "active" && project.slug !== STANDALONE_PROJECT_SLUG).sort(byPriority),
    [projects],
  );
  const standaloneProject = projects.find((project) =>
    project.slug === STANDALONE_PROJECT_SLUG && project.status === "active") ?? null;
  const standaloneThreads = useMemo(
    () => standaloneProject
      ? threads.filter((thread) => thread.projectId === standaloneProject.id).sort(byPriority)
      : [],
    [standaloneProject, threads],
  );
  const activeStandaloneThreads = standaloneThreads.filter((thread) => thread.status === "active");
  const contextMenuOpen = Boolean(projectMenuId || threadMenuId);
  const closeMenus = useCallback(() => {
    setProjectMenuId(null);
    setThreadMenuId(null);
    setProfileMenuOpen(false);
    setHelpOpen(false);
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeProfileMenu = (event: PointerEvent) => {
      if (profileMenuRef.current?.contains(event.target as Node)) return;
      setProfileMenuOpen(false);
    };
    const closeProfileMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
        setHelpOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeProfileMenu);
    document.addEventListener("keydown", closeProfileMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeProfileMenu);
      document.removeEventListener("keydown", closeProfileMenuOnEscape);
    };
  }, [profileMenuOpen]);
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
        data-desktop-state={desktopOpen ? "expanded" : "collapsed"}
        data-context-menu-open={contextMenuOpen ? "true" : "false"}
        className={`fixed inset-y-0 left-0 z-40 flex w-[min(280px,88vw)] flex-col overflow-hidden bg-[var(--sidebar)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] transition-[transform,visibility] duration-200 md:relative md:inset-auto md:flex md:translate-x-0 md:pb-0 md:pt-0 md:transition-[width] ${desktopOpen ? "md:w-[260px]" : "md:w-[52px]"} ${mobileOpen ? "visible translate-x-0 pointer-events-auto" : "invisible -translate-x-full pointer-events-none md:visible md:pointer-events-auto"}`}
      >
        <div aria-hidden={desktopOpen ? "true" : undefined} inert={desktopOpen ? true : undefined} aria-label="Navegación compacta" data-testid="workbench-sidebar-rail" className={`absolute inset-0 hidden h-full w-[52px] flex-col items-center bg-[var(--sidebar)] py-2 transition-opacity duration-150 md:flex ${desktopOpen ? "pointer-events-none opacity-0" : "opacity-100"}`}>
          <button ref={railOpenButtonRef} aria-label="Mostrar barra lateral" className="grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={() => { onOpenDesktop(); requestAnimationFrame(() => desktopCloseButtonRef.current?.focus()); }}><SidebarSimple size={19} /></button>
          <div className="mt-2 flex flex-col items-center gap-1">
            <button disabled={!standaloneProject || busy} aria-label="Nueva conversación" className="grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-35" onClick={() => onNewThread()}><NotePencil size={18} /></button>
            <button aria-label="Buscar" className="grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onOpenCommandPalette}><MagnifyingGlass size={18} /></button>
            <button aria-label="Automatizaciones" title="Automatizaciones" className="grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onOpenAutomations}><CalendarBlank size={18} /></button>
          </div>
          <div className="mt-auto flex flex-col items-center gap-1">
            <button aria-label={`${session.user.name}. Mostrar cuenta`} className="grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onOpenDesktop}><UserAvatar name={session.user.name} avatarUrl={session.user.avatarUrl ?? null} className="size-6" /></button>
          </div>
        </div>
        <div aria-hidden={!(desktopOpen || mobileOpen)} inert={!(desktopOpen || mobileOpen) ? true : undefined} className={`flex h-full w-[min(280px,88vw)] shrink-0 flex-col transition-opacity duration-150 md:w-[260px] ${desktopOpen ? "md:opacity-100" : "md:pointer-events-none md:opacity-0"}`}>
        <div className="flex h-16 shrink-0 items-center justify-between gap-1 px-3">
          <button data-testid="sidebar-brand" type="button" aria-label={`${branding.productName}. Nueva conversación sin proyecto`} className="flex h-10 min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-lg px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" onClick={() => { onNewThread(); onCloseMobile(); }}><BrandMark branding={branding} /><span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-.01em] text-[var(--text)]">{branding.productName}</span></button>
          <div className="flex shrink-0 items-center gap-0.5">
            <button aria-label="Buscar" title="Buscar" className="grid size-9 place-items-center rounded-lg text-[var(--text-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={onOpenCommandPalette}><MagnifyingGlass size={18} /></button>
            <button ref={desktopCloseButtonRef} aria-label="Ocultar barra lateral" className="touch-target hidden rounded-lg p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] md:grid" onClick={() => { onCloseDesktop(); requestAnimationFrame(() => railOpenButtonRef.current?.focus()); }}><SidebarSimple size={18} /></button>
            <button aria-label="Cerrar menú" className="touch-target rounded-lg p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-hover)] md:hidden" onClick={onCloseMobile}><X size={18} /></button>
          </div>
        </div>

        <nav aria-label="Navegación principal" className="px-3 pb-2">
          <SidebarMenu className="gap-0">
            <SidebarMenuItem>
              <SidebarMenuButton icon={PenLine} disabled={!standaloneProject || busy} render={<button onClick={() => onNewThread()} />}>
                Nueva conversación
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton icon={CalendarDays} aria-label="Automatizaciones" title="Gestionar automatizaciones" render={<button onClick={onOpenAutomations} />}>
                Automatizaciones
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </nav>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <section aria-labelledby="standalone-conversations-label" className="group/chats">
            <div className="flex items-center justify-between pb-1 pt-3">
              <button data-testid="sidebar-chats-label" id="standalone-conversations-label" type="button" aria-expanded={chatsOpen} aria-controls="standalone-conversations" className="sidebar-section-label flex items-center gap-1 px-2 py-1 text-[var(--text-subtle)]" onClick={() => setChatsOpen((open) => !open)}>Chats{chatsOpen ? <CaretDown size={11} /> : <CaretRight size={11} />}</button>
              <button disabled={!standaloneProject || busy} aria-label="Nueva conversación independiente" className="grid size-7 place-items-center text-[var(--text-subtle)] opacity-0 transition hover:text-[var(--text)] group-hover/chats:opacity-100 group-focus-within/chats:opacity-100 disabled:opacity-40" onClick={() => onNewThread()}><Plus size={14} /></button>
            </div>
            {chatsOpen ? <SidebarMenu id="standalone-conversations" size="compact" className="gap-0.5">
              {activeStandaloneThreads.length === 0 ? (
                <li className="px-2 py-2 text-[12px] leading-5 text-[var(--text-subtle)]">Tus chats sin proyecto aparecerán aquí.</li>
              ) : activeStandaloneThreads.map((thread) => {
                const active = thread.id === activeThreadId;
                const menuOpen = threadMenuId === thread.id;
                return (
                  <SidebarMenuItem key={thread.id} className={`group/thread ${menuOpen ? "z-40" : ""}`}>
                    <SidebarMenuButton isActive={active} className="sidebar-touch-row" render={<button onClick={() => selectThread(thread.id)} />}>
                      {thread.title}
                      <ThreadActivitySignal activity={threadActivityById[thread.id]} />
                      {thread.pinned ? <PushPin size={10} weight="fill" /> : threadActivityById[thread.id]?.state === "idle" ? <span className="text-[11px] text-[var(--text-subtle)] opacity-0 group-hover/thread:opacity-100">{relativeDate(thread.updatedAt)}</span> : null}
                    </SidebarMenuButton>
                    <button aria-label={`Acciones de ${thread.title}`} aria-expanded={menuOpen} className={`sidebar-item-action absolute right-0 top-0 z-20 grid size-11 place-items-center text-[var(--text-subtle)] opacity-0 hover:text-[var(--text)] group-hover/thread:opacity-100 focus:opacity-100 ${contextMenuOpen && !menuOpen ? "context-menu-suppressed" : ""}`} onClick={() => { setProjectMenuId(null); setThreadMenuId(menuOpen ? null : thread.id); }}><DotsThree size={14} weight="bold" /></button>
                    {menuOpen ? <ItemActions kind="thread" item={thread} onClose={closeMenus} onAction={(action) => { closeMenus(); onThreadAction(thread, action as ThreadMenuAction); }} /> : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu> : null}
          </section>

          <section aria-labelledby="projects-label" className="group/projects mt-3 pt-2">
            <div className="flex items-center justify-between pb-1 pt-2">
              <button data-testid="sidebar-projects-label" id="projects-label" type="button" aria-expanded={projectsOpen} aria-controls="projects-list" className="sidebar-section-label flex items-center gap-1 px-2 py-1 text-[var(--text-subtle)]" onClick={() => setProjectsOpen((open) => !open)}>Proyectos{projectsOpen ? <CaretDown size={11} /> : <CaretRight size={11} />}</button>
              <button aria-label="Crear proyecto" className="touch-target grid size-7 place-items-center text-[var(--text-subtle)] opacity-0 transition hover:text-[var(--text)] group-hover/projects:opacity-100 group-focus-within/projects:opacity-100" onClick={onNewProject}><Plus size={14} /></button>
            </div>
            {projectsOpen ? <SidebarMenu id="projects-list" className="gap-0.5">
              {activeProjects.length === 0 ? (
                <SidebarMenuItem><button className="w-full rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-left text-[12px] leading-5 text-[var(--text-subtle)]" onClick={onNewProject}>Crea tu primer proyecto</button></SidebarMenuItem>
              ) : activeProjects.map((project) => {
                const active = project.id === activeProjectId;
                const menuOpen = projectMenuId === project.id;
                const projectThreadsOpen = !collapsedProjectIds.includes(project.id);
                const activeProjectThreads = threads.filter((thread) => thread.projectId === project.id && thread.status === "active").sort(byPriority);
                const projectActivities = threads
                  .filter((thread) => thread.projectId === project.id && thread.status === "active")
                  .map((thread) => threadActivityById[thread.id])
                  .filter((activity): activity is ThreadActivity => Boolean(activity));
                return (
                  <SidebarMenuItem key={project.id} className={`group/project ${menuOpen ? "z-40" : ""}`}>
                    <SidebarMenuButton icon={active ? FluidFolderOpen : FluidFolder} isActive={active} className="sidebar-touch-row pr-2 group-hover/project:pr-[8.25rem] group-focus-within/project:pr-[8.25rem]" render={<button data-testid="sidebar-project-row" onClick={() => selectProject(project.id)} />}>
                      {project.name}
                      <ProjectActivitySignal activities={projectActivities} />
                      {project.pinned ? <PushPin size={11} weight="fill" className="text-[var(--text-subtle)]" /> : null}
                    </SidebarMenuButton>
                    <button aria-label={projectThreadsOpen ? `Contraer ${project.name}` : `Expandir ${project.name}`} aria-expanded={projectThreadsOpen} className="pointer-events-none absolute right-[5.5rem] top-0 z-20 grid h-11 w-7 place-items-center text-[var(--text-subtle)] opacity-0 transition hover:text-[var(--text)] group-hover/project:pointer-events-auto group-hover/project:opacity-100 group-focus-within/project:pointer-events-auto group-focus-within/project:opacity-100" onClick={() => setCollapsedProjectIds((current) => projectThreadsOpen ? [...current, project.id] : current.filter((id) => id !== project.id))}>{projectThreadsOpen ? <CaretDown size={13} /> : <CaretRight size={13} />}</button>
                    <button disabled={busy} aria-label={`Nueva conversación en ${project.name}`} className="absolute right-[2.75rem] top-0 z-20 grid size-11 place-items-center text-[var(--text-subtle)] opacity-0 transition hover:text-[var(--text)] group-hover/project:opacity-100 focus:opacity-100 disabled:opacity-40" onClick={() => onNewThread(project.id)}><Plus size={14} /></button>
                    <button aria-label={`Acciones de ${project.name}`} aria-expanded={menuOpen} className={`sidebar-item-action absolute right-0 top-0 z-20 grid size-11 place-items-center text-[var(--text-subtle)] opacity-0 hover:text-[var(--text)] group-hover/project:opacity-100 focus:opacity-100 ${contextMenuOpen && !menuOpen ? "context-menu-suppressed" : ""}`} onClick={() => { setThreadMenuId(null); setProjectMenuId(menuOpen ? null : project.id); }}><DotsThree size={15} weight="bold" /></button>
                    {menuOpen ? <ItemActions kind="project" item={project} onClose={closeMenus} onAction={(action) => { closeMenus(); onProjectAction(project, action as ProjectMenuAction); }} /> : null}
                    {projectThreadsOpen ? <div aria-label={`Chats de ${project.name}`} className="mt-0.5">
                      <div className="space-y-0.5">
                        {activeProjectThreads.length === 0 ? <p data-testid="sidebar-project-thread" className="px-2 py-1 text-[11px] leading-5 text-[var(--text-subtle)]">Aún no hay conversaciones.</p> : activeProjectThreads.map((thread) => {
                          const threadActive = thread.id === activeThreadId;
                          const threadMenuOpen = threadMenuId === thread.id;
                          return (
                            <div key={thread.id} className={`relative group/thread ${threadMenuOpen ? "z-40" : ""}`}>
                              <button data-testid="sidebar-project-thread" aria-current={threadActive ? "page" : undefined} className={`sidebar-touch-row flex w-full items-center rounded-lg px-2 py-1.5 pr-11 text-left transition ${threadActive ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"}`} onClick={() => selectThread(thread.id)}>
                                <span className="min-w-0 flex-1 truncate text-[12px] font-normal">{thread.title}</span>
                                <ThreadActivitySignal activity={threadActivityById[thread.id]} />
                                {thread.pinned ? <PushPin size={10} weight="fill" /> : null}
                              </button>
                              <button aria-label={`Acciones de ${thread.title}`} aria-expanded={threadMenuOpen} className={`sidebar-item-action absolute right-0 top-0 z-20 grid size-11 place-items-center text-[var(--text-subtle)] opacity-0 hover:text-[var(--text)] group-hover/thread:opacity-100 focus:opacity-100 ${contextMenuOpen && !threadMenuOpen ? "context-menu-suppressed" : ""}`} onClick={() => { setProjectMenuId(null); setThreadMenuId(threadMenuOpen ? null : thread.id); }}><DotsThree size={13} weight="bold" /></button>
                              {threadMenuOpen ? <ItemActions kind="thread" item={thread} onClose={closeMenus} onAction={(action) => { closeMenus(); onThreadAction(thread, action as ThreadMenuAction); }} /> : null}
                            </div>
                          );
                        })}
                      </div>
                    </div> : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu> : null}
          </section>
        </div>

        <div ref={profileMenuRef} className="relative shrink-0 p-2">
          {profileMenuOpen ? (
            <div role="menu" aria-label="Cuenta y preferencias" className="menu-enter absolute inset-x-2 bottom-[calc(100%-2px)] z-30 rounded-[20px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-1.5 shadow-[var(--shadow-popover)]">
              <p className="truncate px-3 py-2.5 text-[12px] font-semibold text-[var(--text)]" role="presentation">{session.user.name}</p>
              <button role="menuitem" className="flex min-h-10 w-full items-center gap-2.5 rounded-[14px] px-3 text-[12px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={() => { setProfileMenuOpen(false); onOpenCustomization(); }}><GearSix size={16} />Configuración</button>
              <button role="menuitem" aria-expanded={helpOpen} aria-controls="account-help" className="flex min-h-10 w-full items-center gap-2.5 rounded-[14px] px-3 text-[12px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={() => setHelpOpen((open) => !open)}><Question size={16} />Ayuda</button>
              {helpOpen ? <div id="account-help" role="note" className="mx-1 mb-1 rounded-[14px] bg-[var(--surface-muted)] px-3 py-2.5 text-[12px] leading-5 text-[var(--text-secondary)]"><p>Escribe lo que necesitas. El botón + permite adjuntar archivos o elegir conectores autorizados.</p></div> : null}
              <button role="menuitem" className="flex min-h-10 w-full items-center gap-2.5 rounded-[14px] px-3 text-[12px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" onClick={() => void fetch("/api/auth/logout", { method: "POST" }).then((response) => { if (response.ok) router.push("/login"); })}><SignOut size={16} />Cerrar sesión</button>
            </div>
          ) : null}
          <button aria-label={`${session.user.name}. Abrir menú de cuenta`} aria-expanded={profileMenuOpen} className={`flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition ${profileMenuOpen ? "bg-[var(--surface-selected)]" : "hover:bg-[var(--surface-hover)]"}`} onClick={() => { setProjectMenuId(null); setThreadMenuId(null); if (profileMenuOpen) setHelpOpen(false); setProfileMenuOpen((open) => !open); }}>
            <UserAvatar name={session.user.name} avatarUrl={session.user.avatarUrl ?? null} className="size-5" />
            <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-[var(--text)]">{session.user.name}</span><span className="mt-0.5 block truncate text-[12px] text-[var(--text-subtle)]">{branding.companyName}</span></span>
          </button>
        </div>
        </div>
      </aside>
    </>
  );
}
