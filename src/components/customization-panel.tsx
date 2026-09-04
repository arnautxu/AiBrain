"use client";

import { Archive, Bell, Brain, Gauge, PaintBrush, Plugs, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import type { RuntimeStatus } from "@/lib/runtime-status";
import { isSettingsSnapshot, type NotificationSettings, type SettingsPatch, type SettingsSnapshot } from "@/settings/contracts";
import type { CompanyUsageResponse, PersonalUsageResponse } from "@/usage/contracts";
import { useModalFocus } from "@/ui/use-modal-focus";
import { OverlayPresenceLayer } from "@/ui/overlay-presence";
import { ThemeToggle } from "@/components/ui/primitives";
import { MemoryPanel } from "@/components/memory-panel";
import { STANDALONE_PROJECT_SLUG, type WorkbenchProject, type WorkbenchThread } from "@/workbench/types";

type Props = {
  productName: string;
  open: boolean;
  initialTab?: Tab;
  runtimeStatus: RuntimeStatus;
  projects?: WorkbenchProject[];
  threads?: WorkbenchThread[];
  archiveBusy?: boolean;
  onRestoreProject?: (project: WorkbenchProject) => void;
  onRestoreThread?: (thread: WorkbenchThread) => void;
  onSettingsSnapshot?: (snapshot: SettingsSnapshot) => void;
  activeProjectId?: string | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
};
type Tab = "appearance" | "connectors" | "memory" | "notifications" | "archived" | "usage";
const number = (value: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(value);

function planPercent(usage: PersonalUsageResponse | CompanyUsageResponse | null) {
  const windows = usage?.sharedSubscription?.rateLimits.flatMap((bucket) => [bucket.primary, bucket.secondary].filter((item): item is NonNullable<typeof item> => Boolean(item))) ?? [];
  return windows.length ? Math.max(...windows.map((item) => item.usedPercent)) : null;
}

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" aria-label={label} aria-pressed={checked} disabled={disabled} className={`touch-target relative h-5 w-9 rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${checked ? "bg-[var(--notification-accent)]" : "bg-[var(--border-strong)]"}`} onClick={() => onChange(!checked)}><span className={`absolute top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-full bg-[var(--surface-raised)] shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} /></button>;
}

/** Employee preferences only. Workspace governance is server-protected at /admin. */
export function CustomizationPanel({ productName, open, initialTab = "appearance", runtimeStatus, projects = [], threads = [], archiveBusy = false, onRestoreProject, onRestoreThread, onSettingsSnapshot, activeProjectId = null, returnFocusRef, onClose }: Props) {
  const panelRef = useModalFocus(open, onClose, undefined, returnFocusRef);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [personalUsage, setPersonalUsage] = useState<PersonalUsageResponse | null>(null);
  const [companyUsage, setCompanyUsage] = useState<CompanyUsageResponse | null>(null);
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      fetch("/api/settings", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<unknown> : null),
      fetch("/api/usage/me", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<PersonalUsageResponse> : null),
    ]).then(async ([snapshot, personal]) => {
      if (cancelled) return;
      if (!isSettingsSnapshot(snapshot)) { setError("No se ha podido cargar la configuración."); return; }
      setSettings(snapshot); setPersonalUsage(personal); onSettingsSnapshot?.(snapshot);
      if (!snapshot.company.isAdmin) return;
      const response = await fetch("/api/usage/company", { cache: "no-store" });
      const company = response.ok ? await response.json() as CompanyUsageResponse : null;
      if (!cancelled) setCompanyUsage(company);
    }).catch(() => { if (!cancelled) setError("No se ha podido cargar la configuración."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadAttempt, onSettingsSnapshot, open]);

  const save = async (patch: SettingsPatch, key: string) => {
    setSavingKey(key); setError(null);
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || !isSettingsSnapshot(result)) {
        const message = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "No se ha podido guardar el cambio.";
        throw new Error(message);
      }
      setSettings(result); onSettingsSnapshot?.(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se ha podido guardar el cambio."); }
    finally { setSavingKey(null); }
  };

  const usage = companyUsage ?? personalUsage;
  const usedPercent = planPercent(usage);
  const retryLoad = () => {
    setLoading(true);
    setError(null);
    setLoadAttempt((current) => current + 1);
  };
  const tabs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: "appearance", label: "Apariencia", icon: <PaintBrush size={17} /> },
    { id: "connectors", label: "Conectores", icon: <Plugs size={17} /> },
    { id: "memory", label: "Memoria", icon: <Brain size={17} /> },
    { id: "notifications", label: "Avisos", icon: <Bell size={17} /> },
    { id: "archived", label: "Archivados", icon: <Archive size={17} /> },
    { id: "usage", label: "Uso", icon: <Gauge size={17} /> },
  ];
  return <AnimatePresence initial={false}>{open ? (
    <OverlayPresenceLayer key="customization-panel" origin="center" className="workspace-overlay fixed inset-0 z-50 grid place-items-center p-0 md:p-6">
      {(surfaceMotion) => <>
        <button className="absolute inset-0" aria-label="Cerrar configuración" onClick={onClose} />
        <motion.section {...surfaceMotion} ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Configuración de ${productName}`} className="workspace-panel relative flex h-full w-full max-w-[840px] flex-col overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)] md:h-[min(680px,calc(100dvh-3rem))] md:rounded-[22px]">
          <header className="workspace-panel-header flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5"><div><h2 className="workspace-panel-title">Configuración</h2><p className="workspace-panel-subtitle mt-0.5 hidden sm:block">Tu apariencia, avisos, archivados y uso.</p></div><button type="button" aria-label="Cerrar" className="grid size-10 place-items-center rounded-full text-[var(--text-subtle)] hover:bg-[var(--surface-hover)]" onClick={onClose}><X size={17} /></button></header>
          <div className="flex min-h-0 flex-1 flex-col md:flex-row"><nav aria-label="Secciones de configuración" className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] p-2 md:w-52 md:flex-col md:border-b-0 md:border-r md:p-3">{tabs.map((item) => <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} className={`flex min-h-10 shrink-0 items-center gap-2.5 rounded-[12px] px-3 text-left text-[12px] font-medium ${tab === item.id ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`} onClick={() => setTab(item.id)}>{item.icon}{item.label}</button>)}</nav>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">{error ? <div className="mb-5 flex items-center justify-between gap-3 rounded-[12px] border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-[11px] text-[var(--danger)]"><p role="alert">{error}</p>{!settings ? <button type="button" className="shrink-0 rounded-lg border border-current px-3 py-2 font-semibold hover:bg-[var(--surface-hover)]" onClick={retryLoad}>Reintentar</button> : null}</div> : null}{loading && !settings ? <p className="text-[12px] text-[var(--text-subtle)]">Cargando configuración…</p> : null}{tab === "appearance" ? <Appearance /> : null}{tab === "connectors" ? <Connectors settings={settings} onChanged={retryLoad} /> : null}{tab === "memory" ? <MemorySettings productName={productName} settings={settings} projectId={activeProjectId} /> : null}{tab === "notifications" ? <Notifications settings={settings} busy={savingKey === "notifications"} onSave={save} /> : null}{tab === "archived" ? <Archived projects={projects} threads={threads} busy={archiveBusy} onRestoreProject={onRestoreProject} onRestoreThread={onRestoreThread} /> : null}{tab === "usage" ? <Usage usage={usage} companyUsage={companyUsage} usedPercent={usedPercent} runtimeStatus={runtimeStatus} /> : null}</div>
          </div>
        </motion.section>
      </>}
    </OverlayPresenceLayer>
  ) : null}</AnimatePresence>;
}

function Appearance() { return <section><SectionTitle>Tema</SectionTitle><div className="flex items-center justify-between rounded-[var(--brain-radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"><div><p className="text-[12px] font-semibold">Claro u oscuro</p><p className="mt-1 text-[11px] text-[var(--text-subtle)]">Se guarda en este navegador.</p></div><ThemeToggle /></div></section>; }
const subscribeConnectorCallback = () => () => undefined;
function connectorCallbackStatus() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("connection") === "failed" || [params.get("gmail"), params.get("outlook")].some(status => status === "failed" || status === "denied")) return "failed";
  return params.get("connection") === "verified" ? "returned" : "none";
}
function Connectors({ settings, onChanged }: { settings: SettingsSnapshot | null; onChanged: () => void }) {
  const callbackStatus = useSyncExternalStore(subscribeConnectorCallback, connectorCallbackStatus, () => "none");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const disconnect = async (url: string) => { setBusy(true); setError(null); try { const response = await fetch(url, { method: "POST" }); const body: unknown = await response.json().catch(() => null); if (!response.ok) throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "No se ha podido desconectar."); if (body && typeof body === "object" && "providerRevoked" in body && body.providerRevoked === false) setError("Acceso local desconectado. La revocación en el proveedor sigue pendiente; reintenta Desconectar."); onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se ha podido desconectar."); } finally { setBusy(false); } };
  return <section><SectionTitle>Conectores personales</SectionTitle>{callbackStatus === "failed" ? <p role="alert" className="mb-3 text-[11px] text-[var(--danger)]">No se completó la conexión. Reintenta Conectar; si has cerrado sesión, inicia sesión primero.</p> : callbackStatus === "returned" ? <p role="status" className="mb-3 text-[11px] text-[var(--text-subtle)]">Has vuelto de autorizar la cuenta. Consulta abajo el estado verificado de tus conexiones.</p> : null}<p className="mb-4 text-[12px] leading-5 text-[var(--text-muted)]">Solo ves el catálogo habilitado para tu empresa y tus grupos. Cada conexión pertenece únicamente a tu usuario; nunca se comparte con otro empleado.</p>{settings?.connectors.some(connector => connector.id.startsWith("composio-")) ? <p className="mb-4 text-[12px] leading-5 text-[var(--text-muted)]">Para usar estas apps después de conectarlas, abre un chat nuevo y selecciónalas con @. Los chats anteriores pueden no tener las nuevas herramientas.</p> : null}<div className="space-y-3">{settings?.connectors.map((connector) => <article key={connector.id} className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-[12px] font-semibold">{connector.label}</p><p className="mt-1 text-[11px] text-[var(--text-subtle)]">{connector.accountEmail ?? connector.statusDetail}</p></div><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${connector.status === "connected" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : connector.status === "admin_setup_required" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--surface-muted)] text-[var(--text-subtle)]"}`}>{connector.status === "connected" ? "Conectado" : connector.status === "requires_login" ? "Listo para conectar" : connector.status === "admin_setup_required" ? "Falta configuración" : "No disponible"}</span></div><p className="mt-3 text-[10px] leading-4 text-[var(--text-subtle)]">Permiso: acceso de lectura a {connector.label}. No permite enviar, borrar ni modificar datos.</p><div className="mt-4 flex justify-end">{connector.disconnectUrl ? <button type="button" disabled={busy} onClick={() => void disconnect(connector.disconnectUrl!)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold disabled:opacity-50">Desconectar {connector.label}</button> : null}{connector.connectUrl ? <a href={connector.connectUrl} className="rounded-lg bg-[var(--brain-accent)] px-3 py-2 text-[11px] font-semibold text-[var(--brain-contrast)]">Conectar {connector.label}</a> : null}</div></article>)}{settings && settings.connectors.length === 0 ? <p className="text-[11px] text-[var(--text-subtle)]">No hay conexiones habilitadas para tu usuario. El administrador debe configurar Google/Microsoft OAuth o el proveedor de apps para poder conectar correo, Calendar, Drive o GitHub.</p> : null}</div>{error ? <p role="alert" className="mt-3 text-[11px] text-[var(--danger)]">{error}</p> : null}</section>;
}
function MemorySettings({ productName, settings, projectId }: { productName: string; settings: SettingsSnapshot | null; projectId: string | null }) { return <section><SectionTitle>Memoria de trabajo</SectionTitle><div className="mb-5 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-[12px] font-semibold">Automática y activa en tu entorno privado</p><p className="mt-2 text-[11px] leading-5 text-[var(--text-subtle)]">Al terminar un turno, {productName} guarda en segundo plano solo preferencias, hechos estables y decisiones útiles. No añade espera a la respuesta.</p><ul className="mt-3 space-y-1 text-[10px] text-[var(--text-subtle)]"><li>Privacidad: almacenamiento y runtime separados por empleado.</li><li>Seguridad: secretos, credenciales e instrucciones efímeras se descartan.</li><li>Control: cada recuerdo conserva procedencia y revisión, y se puede corregir o eliminar.</li></ul></div>{settings?.memory.enabled ? <MemoryPanel open embedded productName={productName} projectId={projectId} onClose={() => undefined} /> : null}</section>; }
function Notifications({ settings, busy, onSave }: { settings: SettingsSnapshot | null; busy: boolean; onSave: (patch: SettingsPatch, key: string) => Promise<void> }) { return <section><SectionTitle>Avisos de trabajo</SectionTitle><p className="mb-4 text-[12px] leading-5 text-[var(--text-muted)]">Controla los avisos de esta aplicación. No se solicita permiso del sistema operativo desde esta pantalla.</p><div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]"><NotificationToggle field="backgroundTurns" title="Tareas terminadas" description="Avisa cuando una conversación termina mientras trabajas en otra." settings={settings} busy={busy} onSave={onSave} /><NotificationToggle field="approvals" title="Aprobaciones pendientes" description="Avisa cuando una acción necesita tu decisión." settings={settings} busy={busy} onSave={onSave} /><NotificationToggle field="failures" title="Errores y bloqueos" description="Avisa cuando una tarea requiere atención." settings={settings} busy={busy} onSave={onSave} /><NotificationToggle field="sound" title="Sonido" description="Reproduce un sonido discreto para avisos dentro de la aplicación." settings={settings} busy={busy} onSave={onSave} /></div></section>; }
function Archived({ projects, threads, busy, onRestoreProject, onRestoreThread }: { projects: WorkbenchProject[]; threads: WorkbenchThread[]; busy: boolean; onRestoreProject?: (project: WorkbenchProject) => void; onRestoreThread?: (thread: WorkbenchThread) => void }) {
  const archivedProjects = projects.filter((project) => project.status === "archived" && project.slug !== STANDALONE_PROJECT_SLUG);
  const archivedThreads = threads.filter((thread) => thread.status === "archived");
  const archivedProjectIds = new Set(archivedProjects.map((project) => project.id));
  if (!archivedProjects.length && !archivedThreads.length) return <section><SectionTitle>Archivados</SectionTitle><div className="rounded-[16px] border border-dashed border-[var(--border)] px-5 py-8 text-center"><p className="text-[12px] font-semibold text-[var(--text)]">No hay elementos archivados</p><p className="mt-1 text-[11px] text-[var(--text-subtle)]">Las conversaciones y proyectos archivados aparecerán únicamente aquí.</p></div></section>;
  return <section><SectionTitle>Archivados</SectionTitle><p className="mb-5 text-[12px] leading-5 text-[var(--text-muted)]">Restaura desde aquí las conversaciones y proyectos que quieras devolver al sidebar.</p>{archivedProjects.length ? <div className="mb-6"><h4 className="mb-2 text-[11px] font-semibold text-[var(--text-secondary)]">Proyectos</h4><div className="divide-y divide-[var(--border-subtle)] rounded-[14px] border border-[var(--border)]">{archivedProjects.map((project) => <div key={project.id} className="flex items-center gap-3 px-4 py-3"><Archive size={15} className="shrink-0 text-[var(--text-subtle)]" /><span className="min-w-0 flex-1 truncate text-[12px] font-medium">{project.name}</span><button type="button" disabled={busy || !onRestoreProject} className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-45" onClick={() => onRestoreProject?.(project)}>Restaurar</button></div>)}</div></div> : null}{archivedThreads.length ? <div><h4 className="mb-2 text-[11px] font-semibold text-[var(--text-secondary)]">Conversaciones</h4><div className="divide-y divide-[var(--border-subtle)] rounded-[14px] border border-[var(--border)]">{archivedThreads.map((thread) => { const parent = projects.find((project) => project.id === thread.projectId); const parentArchived = archivedProjectIds.has(thread.projectId); return <div key={thread.id} className="flex items-center gap-3 px-4 py-3"><Archive size={15} className="shrink-0 text-[var(--text-subtle)]" /><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium">{thread.title}</span>{parent ? <span className="mt-0.5 block truncate text-[10px] text-[var(--text-subtle)]">{parent.name}</span> : null}</span><button type="button" disabled={busy || parentArchived || !onRestoreThread} title={parentArchived ? "Restaura primero el proyecto" : undefined} className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-45" onClick={() => onRestoreThread?.(thread)}>Restaurar</button></div>; })}</div></div> : null}</section>;
}
function NotificationToggle({ field, title, description, settings, busy, onSave }: { field: keyof NotificationSettings; title: string; description: string; settings: SettingsSnapshot | null; busy: boolean; onSave: (patch: SettingsPatch, key: string) => Promise<void> }) { const checked = settings?.notifications[field] ?? false; return <div className="flex items-center gap-4 py-3.5"><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">{title}</p><p className="mt-1 text-[11px] leading-4 text-[var(--text-subtle)]">{description}</p></div><Toggle label={title} checked={checked} disabled={!settings || busy} onChange={(value) => void onSave({ target: "notifications", values: { [field]: value } }, "notifications")} /></div>; }
function Usage({ usage, companyUsage, usedPercent }: { usage: PersonalUsageResponse | CompanyUsageResponse | null; companyUsage: CompanyUsageResponse | null; usedPercent: number | null; runtimeStatus: RuntimeStatus }) { const internal = usage?.internal; const minutes = internal ? Math.round(internal.totalDurationMs / 60_000) : null; return <section><SectionTitle>Suscripción compartida</SectionTitle><div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5"><div className="flex items-end justify-between gap-4"><div><p className="text-[12px] font-semibold">Servicio de empresa</p><p className="mt-1 text-[11px] text-[var(--text-subtle)]">Consumo global del servicio compartido</p></div><p className="text-[28px] font-semibold tracking-[-.03em]">{usedPercent === null ? "—" : `${Math.round(usedPercent)}%`}</p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-[var(--brain-accent)]" style={{ width: `${usedPercent ?? 0}%` }} /></div></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Metric label="Turnos" value={number(internal?.turns ?? 0)} /><Metric label="Tokens medidos" value={number(internal?.tokens.totalTokens ?? 0)} /><Metric label="Minutos trabajados" value={minutes === null ? "—" : `${number(minutes)} min`} /></div><p className="mt-3 text-[10px] leading-4 text-[var(--text-subtle)]">Suma de la duración de los turnos finalizados, redondeada al minuto más cercano.</p>{companyUsage ? <div className="mt-7"><SectionTitle>Uso por empleado</SectionTitle><div className="divide-y divide-[var(--border-subtle)] rounded-[16px] border border-[var(--border)]">{companyUsage.members.map((member) => <div key={member.userId} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 text-[11px]"><span className="truncate font-semibold">{member.displayName}</span><span className="text-[var(--text-subtle)]">{number(member.usage.turns)} turnos</span><span className="min-w-20 text-right text-[var(--text-secondary)]">{number(Math.round(member.usage.totalDurationMs / 60_000))} min</span></div>)}</div></div> : null}</section>; }
function SectionTitle({ children }: { children: ReactNode }) { return <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">{children}</h3>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-[14px] border border-[var(--border)] p-4"><p className="text-[10px] font-medium text-[var(--text-subtle)]">{label}</p><p className="mt-2 text-[18px] font-semibold">{value}</p></div>; }
