"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowClockwise,
  CaretDown,
  CaretRight,
  ChatCircleDots,
  Code,
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
import Link from "next/link";
import type { AuthSession } from "@/auth/types";
import type { RuntimeStatus } from "@/lib/runtime-status";
import type {
  WorkbenchPersistence,
  WorkbenchProject,
  WorkbenchThread,
} from "@/workbench/types";

export type ProjectMenuAction = "rename" | "pin" | "unpin" | "archive" | "restore";
export type ThreadMenuAction = "rename" | "pin" | "unpin" | "archive" | "restore";

type SidebarProps = {
  productName: string;
  session: AuthSession;
  runtimeStatus: RuntimeStatus;
  persistence: WorkbenchPersistence;
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
  onOpenAutomations: () => void;
};

function relativeDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  const difference = Date.now() - parsed.getTime();
  if (difference < 86_400_000) return "Avui";
  if (difference < 172_800_000) return "Ahir";
  return new Intl.DateTimeFormat("ca", { day: "numeric", month: "short" }).format(parsed);
}

function byPriority<Item extends { pinned: boolean; updatedAt: string }>(a: Item, b: Item) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function ProjectActions({
  project,
  onAction,
}: {
  project: WorkbenchProject;
  onAction: (action: ProjectMenuAction) => void;
}) {
  return (
    <div className="absolute right-1 top-8 z-20 w-36 rounded-xl border border-[#d8d6d1] bg-[#fbfbf9] p-1 shadow-[0_18px_40px_-24px_rgba(0,0,0,.55)]">
      {project.status === "active" ? (
        <>
          <MenuButton icon={<NotePencil size={12} />} label="Reanomena" onClick={() => onAction("rename")} />
          <MenuButton icon={<PushPin size={12} />} label={project.pinned ? "Desfixa" : "Fixa"} onClick={() => onAction(project.pinned ? "unpin" : "pin")} />
          <MenuButton danger icon={<Archive size={12} />} label="Arxiva" onClick={() => onAction("archive")} />
        </>
      ) : (
        <MenuButton icon={<FolderOpen size={12} />} label="Restaura" onClick={() => onAction("restore")} />
      )}
    </div>
  );
}

function ThreadActions({
  thread,
  onAction,
}: {
  thread: WorkbenchThread;
  onAction: (action: ThreadMenuAction) => void;
}) {
  return (
    <div className="absolute right-1 top-8 z-20 w-36 rounded-xl border border-[#d8d6d1] bg-[#fbfbf9] p-1 shadow-[0_18px_40px_-24px_rgba(0,0,0,.55)]">
      {thread.status === "active" ? (
        <>
          <MenuButton icon={<NotePencil size={12} />} label="Reanomena" onClick={() => onAction("rename")} />
          <MenuButton icon={<PushPin size={12} />} label={thread.pinned ? "Desfixa" : "Fixa"} onClick={() => onAction(thread.pinned ? "unpin" : "pin")} />
          <MenuButton danger icon={<Archive size={12} />} label="Arxiva" onClick={() => onAction("archive")} />
        </>
      ) : (
        <MenuButton icon={<ChatCircleDots size={12} />} label="Restaura" onClick={() => onAction("restore")} />
      )}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[9px] font-medium transition hover:bg-[#ecebe7] ${danger ? "text-[#8d4d38]" : "text-[#5f5c57]"}`} onClick={onClick}>
      {icon}{label}
    </button>
  );
}

export function Sidebar({
  productName,
  session,
  runtimeStatus,
  persistence,
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
  onOpenAutomations,
}: SidebarProps) {
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [archivedProjectsOpen, setArchivedProjectsOpen] = useState(false);
  const [archivedThreadsOpen, setArchivedThreadsOpen] = useState(false);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "active").sort(byPriority),
    [projects],
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => project.status === "archived").sort(byPriority),
    [projects],
  );
  const projectThreads = useMemo(
    () => threads
      .filter((thread) => thread.projectId === activeProjectId)
      .sort(byPriority),
    [activeProjectId, threads],
  );
  const activeThreads = projectThreads.filter((thread) => thread.status === "active");
  const archivedThreads = projectThreads.filter((thread) => thread.status === "archived");
  const runtimeCopy = runtimeStatus.ready
    ? session.user.role === "owner" ? "Codex connectat" : "AiBrain preparat"
    : runtimeStatus.codex === "checking"
      ? "Comprovant Codex"
      : runtimeStatus.mode === "demo"
        ? "Mode demostració"
        : "Codex no disponible";
  const persistenceCopy = persistence === "supabase"
    ? "Supabase"
    : persistence === "browser-preview"
      ? "Preview navegador"
      : "Servidor local";

  const closeMenus = () => {
    setProjectMenuId(null);
    setThreadMenuId(null);
  };

  return (
    <>
      {mobileOpen ? <button aria-label="Tancar menú lateral" className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] md:hidden" onClick={onCloseMobile} /> : null}

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[286px] flex-col border-r border-[#d8d6d1] bg-[#efefec] transition-[transform,visibility] duration-200 md:static md:w-[280px] md:translate-x-0 ${desktopOpen ? "md:flex" : "md:hidden"} ${mobileOpen ? "visible translate-x-0 pointer-events-auto" : "invisible -translate-x-full pointer-events-none md:visible md:pointer-events-auto"}`}>
        <div className="flex h-12 shrink-0 items-center justify-between px-3">
          <div className="flex min-w-0 items-center gap-2 px-1">
            <span className="grid size-6 place-items-center rounded-lg bg-[#20201f] text-white"><Code size={13} weight="bold" /></span>
            <span className="truncate text-[11px] font-semibold tracking-[-0.01em] text-[#292725]">{productName}</span>
            <span className="rounded bg-[#e4e3df] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-[#77746f]">alpha</span>
          </div>
          <button aria-label="Amaga la barra lateral" className="hidden rounded-md p-1.5 text-[#77746f] transition hover:bg-[#e2e1dd] hover:text-[#34312d] md:block" onClick={onCloseDesktop}><SidebarSimple size={16} /></button>
          <button aria-label="Tancar menú" className="rounded-md p-1.5 text-[#77746f] hover:bg-[#e6e5e1] md:hidden" onClick={onCloseMobile}><X size={16} /></button>
        </div>

        <div className="space-y-1 px-2 pb-2 pt-1">
          <button disabled={!activeProject || busy} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium text-[#3c3a37] transition hover:bg-[#e7e6e2] disabled:opacity-40" onClick={onNewThread}>
            <Plus size={14} />
            Nou fil
          </button>
          <button className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[#88857f] transition hover:border-[#d6d4cf] hover:bg-[#f8f8f6] hover:text-[#4d4a46]" onClick={onOpenCommandPalette}>
            <MagnifyingGlass size={12} />
            <span className="min-w-0 flex-1 text-[10px]">Cerca projectes i fils</span>
            <span className="rounded border border-[#d6d4cf] bg-[#efefec] px-1.5 py-0.5 text-[8px] font-medium text-[#8e8a83]">⌘K</span>
          </button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-y border-[#d8d6d1] px-2 py-2">
          <div className="flex items-center justify-between px-2.5 pb-1.5">
            <p className="text-[9px] font-semibold text-[#918e88]">Projectes</p>
            <button aria-label="Crea un projecte" className="rounded-md p-1 text-[#85827c] hover:bg-[#e5e4e0] hover:text-[#3b3936]" onClick={onNewProject}><Plus size={12} /></button>
          </div>
          <div className="space-y-1">
            {activeProjects.length === 0 ? (
              <button className="w-full rounded-lg border border-dashed border-[#d8d6d1] px-3 py-3 text-left text-[9px] leading-4 text-[#8f8c86]" onClick={onNewProject}>Crea el primer projecte per començar.</button>
            ) : activeProjects.map((project) => {
              const active = project.id === activeProjectId;
              const menuOpen = projectMenuId === project.id;
              return (
                <div key={project.id}>
                  <div className="relative group">
                    <button className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 pr-8 text-left transition ${active ? "bg-[#deddd8] text-[#2d2b28]" : "text-[#65625d] hover:bg-[#e5e4e0] hover:text-[#34322f]"}`} onClick={() => { closeMenus(); onSelectProject(project.id); }}>
                      {active ? <FolderOpen size={14} weight="fill" /> : <Folder size={14} />}
                      <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">{project.name}</span>
                      {project.pinned ? <PushPin size={10} weight="fill" className="shrink-0 text-[#8e8a84]" /> : null}
                    </button>
                    <button aria-label={`Accions de ${project.name}`} aria-expanded={menuOpen} className="absolute right-1 top-1.5 rounded-md p-1.5 text-[#8e8b85] opacity-0 hover:bg-[#d4d3ce] group-hover:opacity-100 focus:opacity-100" onClick={() => { setThreadMenuId(null); setProjectMenuId(menuOpen ? null : project.id); }}><DotsThree size={14} weight="bold" /></button>
                    {menuOpen ? <ProjectActions project={project} onAction={(action) => { closeMenus(); onProjectAction(project, action); }} /> : null}
                  </div>

                  {active ? (
                    <div className="ml-[17px] border-l border-[#d6d4cf] pb-1 pl-2 pt-1">
                      <div className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-[#88847d]">
                        <Code size={11} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[8px] font-medium">{project.workspace.label}</span>
                        <span className={`size-1.5 rounded-full ${project.workspace.status === "ready" ? "bg-[#5e8a67]" : "bg-[#c89b45]"}`} />
                      </div>
                      {activeThreads.length === 0 ? (
                        <p className="px-2 py-2 text-[9px] leading-4 text-[#99968f]">Els fils nous apareixeran aquí.</p>
                      ) : activeThreads.map((thread) => {
                        const threadActive = thread.id === activeThreadId;
                        const threadMenuOpen = threadMenuId === thread.id;
                        return (
                          <div key={thread.id} className="relative group/thread">
                            <button className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 pr-8 text-left transition ${threadActive ? "bg-[#d9d8d3] text-[#2d2b28]" : "text-[#706d67] hover:bg-[#e5e4e0] hover:text-[#34322f]"}`} onClick={() => { closeMenus(); onSelectThread(thread.id); }}>
                              <ChatCircleDots size={12} className="shrink-0" weight={threadActive ? "fill" : "regular"} />
                              <span className="min-w-0 flex-1 truncate text-[9px] font-medium">{thread.title}</span>
                              {thread.pinned ? <PushPin size={8} weight="fill" className="shrink-0 text-[#8e8a84]" /> : <span className="text-[7px] text-[#9b9790] opacity-0 group-hover/thread:opacity-100">{relativeDate(thread.updatedAt)}</span>}
                            </button>
                            <button aria-label={`Accions de ${thread.title}`} aria-expanded={threadMenuOpen} className="absolute right-1 top-1 rounded-md p-1.5 text-[#8e8b85] opacity-0 hover:bg-[#d1d0cb] group-hover/thread:opacity-100 focus:opacity-100" onClick={() => { setProjectMenuId(null); setThreadMenuId(threadMenuOpen ? null : thread.id); }}><DotsThree size={13} weight="bold" /></button>
                            {threadMenuOpen ? <ThreadActions thread={thread} onAction={(action) => { closeMenus(); onThreadAction(thread, action); }} /> : null}
                          </div>
                        );
                      })}
                      {archivedThreads.length > 0 ? (
                        <div className="pt-1">
                          <button className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[8px] font-medium text-[#95918b] hover:bg-[#e5e4e0]" onClick={() => setArchivedThreadsOpen((current) => !current)}>
                            {archivedThreadsOpen ? <CaretDown size={10} /> : <CaretRight size={10} />} Arxivats · {archivedThreads.length}
                          </button>
                          {archivedThreadsOpen ? archivedThreads.map((thread) => (
                            <div key={thread.id} className="relative group/thread">
                              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 pr-8 text-[#99968f]"><Archive size={11} /><span className="min-w-0 flex-1 truncate text-[8px]">{thread.title}</span></div>
                              <button aria-label={`Accions de ${thread.title}`} className="absolute right-1 top-1 rounded-md p-1.5 text-[#8e8b85] opacity-0 hover:bg-[#deddd8] group-hover/thread:opacity-100 focus:opacity-100" onClick={() => setThreadMenuId(threadMenuId === thread.id ? null : thread.id)}><DotsThree size={12} /></button>
                              {threadMenuId === thread.id ? <ThreadActions thread={thread} onAction={(action) => { closeMenus(); onThreadAction(thread, action); }} /> : null}
                            </div>
                          )) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {archivedProjects.length > 0 ? (
            <div className="mt-1">
              <button className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[8px] font-medium text-[#95918b] hover:bg-[#e8e7e3]" onClick={() => setArchivedProjectsOpen((current) => !current)}>
                {archivedProjectsOpen ? <CaretDown size={10} /> : <CaretRight size={10} />} Arxivats · {archivedProjects.length}
              </button>
              {archivedProjectsOpen ? archivedProjects.map((project) => (
                <div key={project.id} className="relative group">
                  <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 pr-8 text-[#99968f]">
                    <Archive size={12} /><span className="min-w-0 flex-1 truncate text-[9px]">{project.name}</span>
                  </div>
                  <button aria-label={`Accions de ${project.name}`} className="absolute right-1 top-1 rounded-md p-1.5 text-[#8e8b85] opacity-0 hover:bg-[#deddd8] group-hover:opacity-100 focus:opacity-100" onClick={() => setProjectMenuId(projectMenuId === project.id ? null : project.id)}><DotsThree size={13} /></button>
                  {projectMenuId === project.id ? <ProjectActions project={project} onAction={(action) => { closeMenus(); onProjectAction(project, action); }} /> : null}
                </div>
              )) : null}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-[#deddd9] p-2">
          <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[#65625d] transition hover:bg-[#e7e6e2] hover:text-[#33312e]" onClick={onOpenAutomations}>
            <ArrowClockwise size={14} />
            <span className="flex-1 text-[10px] font-medium">Automatitzacions</span>
          </button>
          {session.user.role === "owner" ? (
            <Link href="/control" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[#65625d] transition hover:bg-[#e7e6e2] hover:text-[#33312e]">
              <GearSix size={14} />
              <span className="flex-1 text-[10px] font-medium">Control plane</span>
            </Link>
          ) : null}
          <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[#65625d] transition hover:bg-[#e7e6e2] hover:text-[#33312e]" onClick={onOpenCustomization}>
            <GearSix size={14} />
            <span className="flex-1 text-[10px] font-medium">Personalització</span>
            <SidebarSimple size={12} />
          </button>
          <div className="mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2">
            <span className={`size-1.5 rounded-full ${runtimeStatus.ready ? "bg-[#4f8a5d]" : runtimeStatus.codex === "checking" ? "bg-[#d4a64c] motion-safe:animate-pulse" : "bg-[#aaa7a1]"}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9px] font-medium text-[#716e69]">{runtimeCopy}</p>
              <p className="mt-0.5 truncate text-[8px] text-[#a09d97]">{session.user.role === "owner" ? `${persistenceCopy} · ${runtimeStatus.authMode ?? runtimeStatus.mode}` : "Entorn segur de l’empresa"}</p>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#e0dfda] bg-[#f8f8f6] px-2.5 py-2">
            <UserCircle size={16} className="shrink-0 text-[#77746f]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9px] font-semibold text-[#55524e]">{session.user.name}</p>
              <p className="mt-0.5 truncate text-[8px] text-[#9a9791]">{session.tenant.name} · {session.user.role}</p>
            </div>
            <button
              aria-label="Tanca la sessió"
              className="rounded-md p-1.5 text-[#918e88] hover:bg-[#e9e8e4] hover:text-[#4b4844]"
              onClick={() => void fetch("/api/auth/logout", { method: "POST" }).then((response) => {
                if (response.ok) window.location.assign("/login");
              })}
            >
              <SignOut size={13} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
