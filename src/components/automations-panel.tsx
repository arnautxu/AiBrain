"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarBlank,
  Clock,
  Pause,
  PencilSimple,
  Play,
  Plus,
  SpinnerGap,
  Trash,
} from "@phosphor-icons/react";
import type { AutomationAudienceDirectory, AutomationRun, AutomationSchedule, AutomationTask, AutomationTaskView } from "@/automations/contracts";
import { AUTOMATION_TIME_ZONES } from "@/automations/contracts";
import { describeSchedule, localMinuteToInstant, localParts } from "@/automations/schedule";
import type { WorkbenchProject } from "@/workbench/types";
import { STANDALONE_PROJECT_SLUG } from "@/workbench/types";

type ScheduleKind = AutomationSchedule["kind"];
const weekdays = ["D", "L", "M", "X", "J", "V", "S"];

function dateLabel(value: string | null, timeZone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}

function localInput(iso: string | null, timeZone = "Europe/Madrid") {
  const parts = localParts(iso ? new Date(iso) : new Date(Date.now() + 3_600_000), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function scheduleTime(task: AutomationTask | null) {
  if (!task || task.schedule.kind === "once") return "09:00";
  return `${String(task.schedule.hour).padStart(2, "0")}:${String(task.schedule.minute).padStart(2, "0")}`;
}

const emptyDirectory: AutomationAudienceDirectory = {
  membershipPolicy: "current",
  currentUserId: "",
  users: [],
  groups: [],
};

function audienceLabel(task: AutomationTask, directory: AutomationAudienceDirectory) {
  const users = new Map(directory.users.map((user) => [user.id, user.name]));
  const groups = new Map(directory.groups.map((group) => [group.id, group.name]));
  const labels = [
    ...task.audience.userIds.map((id) => users.get(id) ?? "Usuario no disponible"),
    ...task.audience.groupIds.map((id) => groups.get(id) ? `Grupo: ${groups.get(id)}` : "Grupo eliminado"),
  ];
  return labels.length > 2 ? `${labels.slice(0, 2).join(", ")} y ${labels.length - 2} más` : labels.join(", ");
}

export function AutomationsPanel({ open, projects, onOpenThread }: {
  open: boolean;
  projects: WorkbenchProject[];
  onOpenThread?: (threadId: string) => void;
}) {
  const availableProjects = useMemo(() => projects.filter((project) => project.status === "active"), [projects]);
  const [tasks, setTasks] = useState<AutomationTaskView[]>([]);
  const [audienceDirectory, setAudienceDirectory] = useState<AutomationAudienceDirectory>(emptyDirectory);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationTask | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("daily");
  const [timeZone, setTimeZone] = useState("Europe/Madrid");
  const [time, setTime] = useState("09:00");
  const [onceAt, setOnceAt] = useState(localInput(null));
  const [selectedWeekdays, setSelectedWeekdays] = useState([1]);
  const [audienceUserIds, setAudienceUserIds] = useState<string[]>([]);
  const [audienceGroupIds, setAudienceGroupIds] = useState<string[]>([]);
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);
  const [runsByTask, setRunsByTask] = useState<Record<string, AutomationRun[]>>({});

  const projectLabel = (project: WorkbenchProject | undefined) =>
    project?.slug === STANDALONE_PROJECT_SLUG ? "Sin proyecto" : project?.name ?? "Sin proyecto";

  const taskProjectLabel = (task: AutomationTask) => {
    const project = projects.find((candidate) => candidate.id === task.projectId);
    return project?.slug === STANDALONE_PROJECT_SLUG || task.projectName.trim().toLocaleLowerCase("es") === "conversaciones"
      ? "Sin proyecto"
      : task.projectName;
  };

  const refresh = async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/automations", { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se han podido cargar las automatizaciones.");
      setTasks(Array.isArray(body.tasks) ? body.tasks : []);
      setAudienceDirectory(body.audienceDirectory ?? emptyDirectory);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "No se han podido cargar las automatizaciones.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [open]);

  const openForm = (task: AutomationTaskView | null) => {
    setEditing(task);
    setName(task?.name ?? "");
    setPrompt(task?.prompt ?? "");
    setProjectId(task?.projectId ?? availableProjects[0]?.id ?? "");
    setKind(task?.schedule.kind ?? "daily");
    setTimeZone(task?.timeZone ?? "Europe/Madrid");
    setTime(scheduleTime(task));
    setOnceAt(localInput(task?.schedule.kind === "once" ? task.schedule.runAt : null, task?.timeZone ?? "Europe/Madrid"));
    setSelectedWeekdays(task?.schedule.kind === "weekly" ? task.schedule.weekdays : [1]);
    setAudienceUserIds(task?.audience.userIds ?? (audienceDirectory.currentUserId ? [audienceDirectory.currentUserId] : []));
    setAudienceGroupIds(task?.audience.groupIds ?? []);
    setError(null);
    setFormOpen(true);
  };

  const schedule = (): AutomationSchedule => {
    const [hour, minute] = time.split(":").map(Number);
    if (kind === "once") {
      const [date, clock] = onceAt.split("T");
      const [year, month, day] = date.split("-").map(Number);
      const [onceHour, onceMinute] = clock.split(":").map(Number);
      return { kind, runAt: localMinuteToInstant({ year, month, day, hour: onceHour, minute: onceMinute }, timeZone).toISOString() };
    }
    if (kind === "daily") return { kind, hour, minute };
    return { kind, weekdays: selectedWeekdays.toSorted(), hour, minute };
  };

  const save = async () => {
    if (!name.trim() || !prompt.trim() || !projectId || (kind === "weekly" && !selectedWeekdays.length) ||
      audienceUserIds.length + audienceGroupIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const selectedProject = availableProjects.find((project) => project.id === projectId);
      const response = await fetch(editing ? `/api/automations/${editing.id}` : "/api/automations", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          prompt,
          projectId,
          projectName: projectLabel(selectedProject),
          timeZone,
          schedule: schedule(),
          audience: { membershipPolicy: "current", userIds: audienceUserIds, groupIds: audienceGroupIds },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se ha podido guardar la automatización.");
      setTasks((current) => [body.task, ...current.filter((task) => task.id !== body.task.id)]);
      setFormOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se ha podido guardar la automatización.");
    } finally {
      setSaving(false);
    }
  };

  const patchTask = async (task: AutomationTaskView, patch: object) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/automations/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se ha podido actualizar.");
      setTasks((current) => current.map((item) => item.id === task.id ? body.task : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se ha podido actualizar.");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (task: AutomationTaskView) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/automations/${task.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: crypto.randomUUID() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se ha podido poner en cola.");
      setTasks((current) => current.map((item) => item.id === task.id ? body.task : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se ha podido poner en cola.");
    } finally {
      setSaving(false);
    }
  };

  const toggleHistory = async (task: AutomationTaskView) => {
    if (historyTaskId === task.id) { setHistoryTaskId(null); return; }
    setHistoryTaskId(task.id);
    try {
      const response = await fetch(`/api/automations/${task.id}/runs`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se ha podido leer el historial.");
      setRunsByTask((current) => ({ ...current, [task.id]: Array.isArray(body.runs) ? body.runs : [] }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se ha podido leer el historial.");
    }
  };

  const deleteTask = async (task: AutomationTaskView) => {
    if (!window.confirm(`¿Eliminar “${task.name}”? El historial de ejecuciones se conserva.`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/automations/${task.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("No se ha podido eliminar.");
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se ha podido eliminar.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return <main aria-labelledby="automations-title" className="automations-page automations-page-panel workspace-panel relative flex min-w-0 flex-1 flex-col bg-[var(--surface-raised)]">
      <header className="workspace-panel-header flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-5">
        <CalendarBlank size={19} />
        <div className="min-w-0 flex-1"><h2 id="automations-title" className="workspace-panel-title text-[var(--text)]">Automatizaciones</h2></div>
        {tasks.length ? <button type="button" disabled={!availableProjects.length} onClick={() => openForm(null)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--text)] px-3 text-[11px] font-semibold text-[var(--surface)] disabled:opacity-35"><Plus size={14} />Nueva</button> : null}
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {error ? <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[11px] text-[var(--danger)]">{error}</p> : null}
        {loading ? <div className="flex min-h-44 items-center justify-center gap-2 text-[11px] text-[var(--text-subtle)]"><SpinnerGap size={15} className="motion-safe:animate-spin" />Cargando automatizaciones…</div> : tasks.length ? <div className="space-y-2.5">{tasks.map((task) => <article key={task.id} className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--text-secondary)]"><Clock size={16} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[13px] font-semibold text-[var(--text)]">{task.name}</h3><span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${task.state === "active" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{task.state === "active" ? "Activa" : task.state === "paused" ? "En pausa" : "Completada"}</span>{task.manualRun ? <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[9px] font-semibold text-[var(--brain-accent-on-soft)]">Ejecución en cola</span> : null}</div><p className="mt-1 truncate text-[10px] text-[var(--text-subtle)]">{taskProjectLabel(task)} · {describeSchedule(task.schedule, task.timeZone)} · {task.timeZone}</p></div></div>
          <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-[var(--text-muted)]">{task.prompt}</p>
          <p className="mt-2 text-[10px] leading-4 text-[var(--text-subtle)]">Destinatarios: {audienceLabel(task, audienceDirectory)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-[10px]"><div><dt className="text-[var(--text-subtle)]">Próxima</dt><dd className="mt-0.5 font-medium text-[var(--text)]">{dateLabel(task.nextRunAt, task.timeZone)}</dd></div><div><dt className="text-[var(--text-subtle)]">Última</dt><dd className={`mt-0.5 font-medium ${task.lastRunStatus === "failed" ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{task.lastRunAt ? `${dateLabel(task.lastRunAt, task.timeZone)}${task.lastRunStatus === "failed" ? " · Falló" : ""}` : "Aún no ejecutada"}</dd></div></dl>
          {task.lastRunError ? <p className="mt-2 text-[10px] leading-4 text-[var(--danger)]">{task.lastRunError}</p> : null}
          <div className="mt-3 flex flex-wrap justify-end gap-1"><button type="button" onClick={() => void toggleHistory(task)} className="min-h-8 rounded-lg px-2 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Historial y resultados</button>{task.access.canManage ? <><button type="button" disabled={saving || Boolean(task.manualRun)} onClick={() => void runNow(task)} className="min-h-8 rounded-lg px-2 text-[10px] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-30">Ejecutar ahora</button><button type="button" disabled={saving || task.state === "completed"} onClick={() => void patchTask(task, { state: task.state === "active" ? "paused" : "active" })} aria-label={task.state === "active" ? `Pausar ${task.name}` : `Reanudar ${task.name}`} className="grid size-8 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-30">{task.state === "active" ? <Pause size={14} /> : <Play size={14} />}</button><button type="button" disabled={saving} onClick={() => openForm(task)} aria-label={`Editar ${task.name}`} className="grid size-8 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><PencilSimple size={14} /></button><button type="button" disabled={saving} onClick={() => void deleteTask(task)} aria-label={`Eliminar ${task.name}`} className="grid size-8 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"><Trash size={14} /></button></> : null}</div>
          {historyTaskId === task.id ? <div className="mt-3 space-y-2 rounded-xl bg-[var(--surface-muted)] p-3">{(runsByTask[task.id] ?? []).length ? (runsByTask[task.id] ?? []).slice(0, 8).map((run) => <div key={`${run.runKey}:${run.attempt}:${run.status}`} className="flex items-center gap-2 text-[10px]"><span className={run.status === "succeeded" ? "text-[var(--positive)]" : run.status === "failed" ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}>{run.status === "succeeded" ? "Completada" : run.status === "failed" ? "Con error" : "En curso"}</span><time className="text-[var(--text-subtle)]">{dateLabel(run.finishedAt ?? run.startedAt, task.timeZone)}</time>{run.threadId && onOpenThread ? <button type="button" onClick={() => onOpenThread(run.threadId!)} className="ml-auto font-semibold text-[var(--brain-accent-on-soft)]">Abrir resultado</button> : null}</div>) : <p className="text-[10px] text-[var(--text-subtle)]">Aún no hay ejecuciones registradas.</p>}</div> : null}
        </article>)}</div> : <div className="grid min-h-64 place-items-center px-8 text-center"><div className="workspace-empty-state"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--surface-muted)] text-[var(--text-subtle)]"><CalendarBlank size={21} /></span><p className="mt-3 text-[13px] font-semibold text-[var(--text)]">Aún no hay automatizaciones</p><p className="mt-1 text-[11px] leading-5 text-[var(--text-subtle)]">Programa trabajo recurrente en un proyecto o Sin proyecto.</p><button type="button" disabled={!availableProjects.length} onClick={() => openForm(null)} className="mx-auto mt-5 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[var(--text)] px-4 text-[11px] font-semibold text-[var(--surface)] disabled:opacity-35"><Plus size={14} />Nueva</button></div></div>}
      </div>

      {formOpen ? <div className="absolute inset-0 z-10 flex flex-col bg-[var(--surface-raised)]">
        <header className="flex min-h-16 items-center border-b border-[var(--border-subtle)] px-5"><button type="button" onClick={() => setFormOpen(false)} className="mr-3 text-[11px] font-medium text-[var(--text-secondary)]">Cancelar</button><h3 className="flex-1 text-[14px] font-semibold text-[var(--text)]">{editing ? "Editar automatización" : "Nueva automatización"}</h3><button type="button" disabled={saving || !name.trim() || !prompt.trim() || !projectId || (kind === "weekly" && !selectedWeekdays.length) || audienceUserIds.length + audienceGroupIds.length === 0} onClick={() => void save()} className="min-h-9 rounded-full bg-[var(--text)] px-4 text-[11px] font-semibold text-[var(--surface)] disabled:opacity-35">{saving ? "Guardando…" : "Guardar"}</button></header>
        <form className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="block text-[11px] font-semibold text-[var(--text)]">Nombre<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Resumen diario del proyecto" className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal outline-none focus:border-[var(--brain-accent)]" /></label>
          <label className="block text-[11px] font-semibold text-[var(--text)]">Qué debe hacer<textarea value={prompt} maxLength={20_000} rows={6} onChange={(event) => setPrompt(event.target.value)} placeholder="Revisa las novedades del proyecto y prepara un resumen con próximos pasos." className="mt-2 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-[13px] font-normal leading-5 outline-none focus:border-[var(--brain-accent)]" /></label>
          <label className="block text-[11px] font-semibold text-[var(--text)]">Proyecto<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal outline-none">{availableProjects.map((project) => <option key={project.id} value={project.id}>{projectLabel(project)}</option>)}</select></label>
          <fieldset><legend className="text-[11px] font-semibold text-[var(--text)]">Quién recibe el resultado</legend><div className="mt-2 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Personas</p><div className="mt-2 grid gap-2">{audienceDirectory.users.map((user) => <label key={user.id} className="flex items-center gap-2 text-[11px] font-normal text-[var(--text)]"><input type="checkbox" checked={audienceUserIds.includes(user.id)} onChange={() => setAudienceUserIds((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])} />{user.name}</label>)}</div></div>
            {audienceDirectory.groups.length ? <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Grupos</p><div className="mt-2 grid gap-2">{audienceDirectory.groups.map((group) => <label key={group.id} className="flex items-center gap-2 text-[11px] font-normal text-[var(--text)]"><input type="checkbox" checked={audienceGroupIds.includes(group.id)} onChange={() => setAudienceGroupIds((current) => current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id])} />{group.name}</label>)}</div></div> : null}
            <p className="text-[10px] leading-4 text-[var(--text-subtle)]">La audiencia y pertenencia actuales se comprueban al abrir cualquier resultado, también los anteriores. Si alguien sale del grupo o se desactiva, pierde el acceso.</p>
          </div></fieldset>
          <fieldset><legend className="text-[11px] font-semibold text-[var(--text)]">Frecuencia</legend><div className="mt-2 flex gap-1 rounded-xl bg-[var(--surface-muted)] p-1">{(["once", "daily", "weekly"] as const).map((option) => <button key={option} type="button" aria-pressed={kind === option} onClick={() => setKind(option)} className={`min-h-9 flex-1 rounded-lg text-[11px] font-medium ${kind === option ? "bg-[var(--surface-raised)] text-[var(--text)] shadow-[var(--shadow-sm)]" : "text-[var(--text-muted)]"}`}>{option === "once" ? "Una vez" : option === "daily" ? "Cada día" : "Semanal"}</button>)}</div></fieldset>
          {kind === "weekly" ? <fieldset><legend className="text-[11px] font-semibold text-[var(--text)]">Días</legend><div className="mt-2 flex gap-1.5">{weekdays.map((label, day) => <button key={day} type="button" aria-pressed={selectedWeekdays.includes(day)} onClick={() => setSelectedWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])} className={`grid size-9 place-items-center rounded-full text-[10px] font-semibold ${selectedWeekdays.includes(day) ? "bg-[var(--text)] text-[var(--surface)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{label}</button>)}</div></fieldset> : null}
          {kind === "once" ? <div className="grid grid-cols-2 gap-3"><label className="block text-[11px] font-semibold text-[var(--text)]">Fecha<input type="date" value={onceAt.split("T")[0] ?? ""} onChange={(event) => setOnceAt(`${event.target.value}T${onceAt.split("T")[1] ?? "09:00"}`)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal" /></label><label className="block text-[11px] font-semibold text-[var(--text)]">Hora<input type="time" value={onceAt.split("T")[1] ?? "09:00"} onChange={(event) => setOnceAt(`${onceAt.split("T")[0] ?? ""}T${event.target.value}`)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal" /></label></div> : <label className="block text-[11px] font-semibold text-[var(--text)]">Hora<input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal" /></label>}
          <label className="block text-[11px] font-semibold text-[var(--text)]">Zona horaria<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal">{AUTOMATION_TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
          <p className="rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-[10px] leading-4 text-[var(--text-muted)]">La tarea crea una conversación en el proyecto y ejecuta este prompt. Las acciones sensibles solo se ejecutan con autorización durable previa; el worker no espera aprobaciones interactivas. No envía mensajes externos por sí sola.</p>
        </form>
      </div> : null}
  </main>;
}
