"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarBlank,
  CheckCircle,
  Clock,
  Pause,
  PencilSimple,
  Play,
  Plus,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { AutomationSchedule, AutomationTask } from "@/automations/contracts";
import { AUTOMATION_TIME_ZONES } from "@/automations/contracts";
import { describeSchedule, localMinuteToInstant, localParts } from "@/automations/schedule";
import type { WorkbenchProject } from "@/workbench/types";
import { useModalFocus } from "@/ui/use-modal-focus";

type WorkerInfo = { heartbeatAt: string; online: boolean } | null;
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

export function AutomationsPanel({ open, projects, onClose }: {
  open: boolean;
  projects: WorkbenchProject[];
  onClose: () => void;
}) {
  const panelRef = useModalFocus(open, onClose);
  const availableProjects = useMemo(() => projects.filter((project) => project.status === "active"), [projects]);
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [worker, setWorker] = useState<WorkerInfo>(null);
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

  const refresh = async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/automations", { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se han podido cargar las automatizaciones.");
      setTasks(Array.isArray(body.tasks) ? body.tasks : []);
      setWorker(body.worker ?? null);
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

  const openForm = (task: AutomationTask | null) => {
    setEditing(task);
    setName(task?.name ?? "");
    setPrompt(task?.prompt ?? "");
    setProjectId(task?.projectId ?? availableProjects[0]?.id ?? "");
    setKind(task?.schedule.kind ?? "daily");
    setTimeZone(task?.timeZone ?? "Europe/Madrid");
    setTime(scheduleTime(task));
    setOnceAt(localInput(task?.schedule.kind === "once" ? task.schedule.runAt : null, task?.timeZone ?? "Europe/Madrid"));
    setSelectedWeekdays(task?.schedule.kind === "weekly" ? task.schedule.weekdays : [1]);
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
    if (!name.trim() || !prompt.trim() || !projectId || (kind === "weekly" && !selectedWeekdays.length)) return;
    setSaving(true);
    setError(null);
    try {
      const selectedProject = availableProjects.find((project) => project.id === projectId);
      const response = await fetch(editing ? `/api/automations/${editing.id}` : "/api/automations", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, prompt, projectId, projectName: selectedProject?.name ?? "Proyecto", timeZone, schedule: schedule() }),
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

  const patchTask = async (task: AutomationTask, patch: object) => {
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

  const deleteTask = async (task: AutomationTask) => {
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
  return <div className="workspace-overlay fixed inset-0 z-[76] flex justify-end">
    <button className="absolute inset-0" aria-label="Cerrar automatizaciones" onClick={onClose} />
    <aside ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="automations-title" className="workspace-panel panel-enter relative flex h-full w-full max-w-[580px] flex-col border-l border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]">
      <header className="workspace-panel-header flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-5">
        <CalendarBlank size={19} />
        <div className="min-w-0 flex-1"><h2 id="automations-title" className="workspace-panel-title text-[var(--text)]">Tareas programadas</h2><p className="workspace-panel-subtitle mt-0.5">Se ejecutan mientras el servicio de la aplicación esté activo.</p></div>
        <button type="button" disabled={!availableProjects.length} onClick={() => openForm(null)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--text)] px-3 text-[11px] font-semibold text-[var(--surface)] disabled:opacity-35"><Plus size={14} />Nueva</button>
        <button type="button" aria-label="Cerrar automatizaciones" onClick={onClose} className="grid size-9 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><X size={17} /></button>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className={`flex items-start gap-2.5 rounded-[16px] border px-3.5 py-3 ${worker?.online ? "border-[var(--border)] bg-[var(--surface)]" : "border-[var(--warning)] bg-[var(--warning-soft)]"}`} role="status">
          {worker?.online ? <CheckCircle size={17} weight="fill" className="mt-0.5 text-[var(--positive)]" /> : <WarningCircle size={17} weight="fill" className="mt-0.5 text-[var(--warning)]" />}
          <div><p className="text-[11px] font-semibold text-[var(--text)]">{worker?.online ? "Servicio de tareas disponible" : "Servicio de tareas desconectado"}</p><p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">{worker?.online ? `Última comprobación: ${dateLabel(worker.heartbeatAt, timeZone)}.` : "Las tareas permanecerán pendientes hasta que el administrador reactive el servicio."} La ejecución depende del servidor de tu empresa.</p></div>
        </div>
        {error ? <p role="alert" className="mt-4 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[11px] text-[var(--danger)]">{error}</p> : null}
        {loading ? <div className="flex min-h-44 items-center justify-center gap-2 text-[11px] text-[var(--text-subtle)]"><SpinnerGap size={15} className="motion-safe:animate-spin" />Cargando tareas…</div> : tasks.length ? <div className="mt-4 space-y-2.5">{tasks.map((task) => <article key={task.id} className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--text-secondary)]"><Clock size={16} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[13px] font-semibold text-[var(--text)]">{task.name}</h3><span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${task.state === "active" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{task.state === "active" ? "Activa" : task.state === "paused" ? "En pausa" : "Completada"}</span></div><p className="mt-1 truncate text-[10px] text-[var(--text-subtle)]">{task.projectName} · {describeSchedule(task.schedule, task.timeZone)} · {task.timeZone}</p></div></div>
          <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-[var(--text-muted)]">{task.prompt}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-[10px]"><div><dt className="text-[var(--text-subtle)]">Próxima</dt><dd className="mt-0.5 font-medium text-[var(--text)]">{dateLabel(task.nextRunAt, task.timeZone)}</dd></div><div><dt className="text-[var(--text-subtle)]">Última</dt><dd className={`mt-0.5 font-medium ${task.lastRunStatus === "failed" ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{task.lastRunAt ? `${dateLabel(task.lastRunAt, task.timeZone)}${task.lastRunStatus === "failed" ? " · Falló" : ""}` : "Aún no ejecutada"}</dd></div></dl>
          {task.lastRunError ? <p className="mt-2 text-[10px] leading-4 text-[var(--danger)]">{task.lastRunError}</p> : null}
          <div className="mt-3 flex justify-end gap-1"><button type="button" disabled={saving || task.state === "completed"} onClick={() => void patchTask(task, { state: task.state === "active" ? "paused" : "active" })} aria-label={task.state === "active" ? `Pausar ${task.name}` : `Reanudar ${task.name}`} className="grid size-8 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-30">{task.state === "active" ? <Pause size={14} /> : <Play size={14} />}</button><button type="button" disabled={saving} onClick={() => openForm(task)} aria-label={`Editar ${task.name}`} className="grid size-8 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><PencilSimple size={14} /></button><button type="button" disabled={saving} onClick={() => void deleteTask(task)} aria-label={`Eliminar ${task.name}`} className="grid size-8 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"><Trash size={14} /></button></div>
        </article>)}</div> : <div className="grid min-h-64 place-items-center px-8 text-center"><div className="workspace-empty-state"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--surface-muted)] text-[var(--text-subtle)]"><CalendarBlank size={21} /></span><p className="mt-3 text-[13px] font-semibold text-[var(--text)]">Aún no hay tareas programadas</p><p className="mt-1 text-[11px] leading-5 text-[var(--text-subtle)]">Programa un resumen, una revisión o una tarea recurrente dentro de un proyecto.</p></div></div>}
      </div>

      {formOpen ? <div className="absolute inset-0 z-10 flex flex-col bg-[var(--surface-raised)]">
        <header className="flex min-h-16 items-center border-b border-[var(--border-subtle)] px-5"><button type="button" onClick={() => setFormOpen(false)} className="mr-3 text-[11px] font-medium text-[var(--text-secondary)]">Cancelar</button><h3 className="flex-1 text-[14px] font-semibold text-[var(--text)]">{editing ? "Editar tarea" : "Nueva tarea"}</h3><button type="button" disabled={saving || !name.trim() || !prompt.trim() || !projectId || (kind === "weekly" && !selectedWeekdays.length)} onClick={() => void save()} className="min-h-9 rounded-full bg-[var(--text)] px-4 text-[11px] font-semibold text-[var(--surface)] disabled:opacity-35">{saving ? "Guardando…" : "Guardar"}</button></header>
        <form className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="block text-[11px] font-semibold text-[var(--text)]">Nombre<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Resumen diario del proyecto" className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal outline-none focus:border-[var(--brain-accent)]" /></label>
          <label className="block text-[11px] font-semibold text-[var(--text)]">Qué debe hacer<textarea value={prompt} maxLength={20_000} rows={6} onChange={(event) => setPrompt(event.target.value)} placeholder="Revisa las novedades del proyecto y prepara un resumen con próximos pasos." className="mt-2 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-[13px] font-normal leading-5 outline-none focus:border-[var(--brain-accent)]" /></label>
          <label className="block text-[11px] font-semibold text-[var(--text)]">Proyecto<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal outline-none">{availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <fieldset><legend className="text-[11px] font-semibold text-[var(--text)]">Frecuencia</legend><div className="mt-2 flex gap-1 rounded-xl bg-[var(--surface-muted)] p-1">{(["once", "daily", "weekly"] as const).map((option) => <button key={option} type="button" aria-pressed={kind === option} onClick={() => setKind(option)} className={`min-h-9 flex-1 rounded-lg text-[11px] font-medium ${kind === option ? "bg-[var(--surface-raised)] text-[var(--text)] shadow-[var(--shadow-sm)]" : "text-[var(--text-muted)]"}`}>{option === "once" ? "Una vez" : option === "daily" ? "Cada día" : "Semanal"}</button>)}</div></fieldset>
          {kind === "weekly" ? <fieldset><legend className="text-[11px] font-semibold text-[var(--text)]">Días</legend><div className="mt-2 flex gap-1.5">{weekdays.map((label, day) => <button key={day} type="button" aria-pressed={selectedWeekdays.includes(day)} onClick={() => setSelectedWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])} className={`grid size-9 place-items-center rounded-full text-[10px] font-semibold ${selectedWeekdays.includes(day) ? "bg-[var(--text)] text-[var(--surface)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{label}</button>)}</div></fieldset> : null}
          {kind === "once" ? <label className="block text-[11px] font-semibold text-[var(--text)]">Fecha y hora<input type="datetime-local" value={onceAt} onChange={(event) => setOnceAt(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal" /></label> : <label className="block text-[11px] font-semibold text-[var(--text)]">Hora<input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal" /></label>}
          <label className="block text-[11px] font-semibold text-[var(--text)]">Zona horaria<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-normal">{AUTOMATION_TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
          <p className="rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-[10px] leading-4 text-[var(--text-muted)]">La tarea crea una conversación en el proyecto y ejecuta este prompt. Cualquier acción sensible seguirá necesitando las aprobaciones configuradas. No envía mensajes externos por sí sola.</p>
        </form>
      </div> : null}
    </aside>
  </div>;
}
