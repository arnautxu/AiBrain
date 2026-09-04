"use client";

import { useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  FileText,
  LinkSimple,
  Plus,
  ShieldCheck,
  SpinnerGap,
  Trash,
  UploadSimple,
  Users,
  X,
} from "@phosphor-icons/react";
import type {
  ProjectMemberRole,
  ProjectSource,
  UpdateProjectInput,
  WorkbenchProject,
  WorkbenchProjectAccess,
} from "@/workbench/types";
import { workbenchProjectAccess } from "@/workbench/types";
import { useModalFocus } from "@/ui/use-modal-focus";
import { OverlayPresenceLayer } from "@/ui/overlay-presence";

type ProjectPanelProps = {
  project: WorkbenchProject | null;
  open: boolean;
  onClose: () => void;
  onSave: (patch: UpdateProjectInput) => Promise<boolean>;
  access?: Readonly<WorkbenchProjectAccess>;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

type Tab = "context" | "sources" | "people";

function readTextFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.readAsText(file);
  });
}

function sourceIcon(kind: ProjectSource["kind"]) {
  return kind === "file" ? <FileText size={15} /> : kind === "link" ? <LinkSimple size={15} /> : <Brain size={15} />;
}

export function ProjectPanel({ project, open, onClose, onSave, access: accessOverride, returnFocusRef }: ProjectPanelProps) {
  const [tab, setTab] = useState<Tab>("context");
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const [memoryEnabled, setMemoryEnabled] = useState(project?.memory.enabled ?? true);
  const [memoryNotes, setMemoryNotes] = useState(project?.memory.notes ?? "");
  const [sources, setSources] = useState<ProjectSource[]>(project?.sources ?? []);
  const [visibility, setVisibility] = useState<"private" | "shared">(project?.sharing.visibility ?? "private");
  const [members, setMembers] = useState<WorkbenchProject["sharing"]["members"]>(project?.sharing.members ?? []);
  const [sourceValue, setSourceValue] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<ProjectMemberRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const access = accessOverride ?? workbenchProjectAccess(project);
  const canEdit = access.canEdit;
  const canManage = access.canManage;
  const modalRef = useModalFocus<HTMLDivElement>(open, () => {
    if (!busy) onClose();
  }, closeButtonRef, returnFocusRef);

  const save = async () => {
    if (!project || !canEdit) return;
    setBusy(true);
    setNotice(null);
    const now = new Date().toISOString();
    const saved = await onSave({
      instructions,
      sources,
      memory: {
        enabled: memoryEnabled,
        notes: memoryNotes,
        updatedAt: memoryNotes === project.memory.notes && memoryEnabled === project.memory.enabled
          ? project.memory.updatedAt
          : now,
      },
      ...(canManage ? { sharing: { visibility, members } } : {}),
    });
    setBusy(false);
    setNotice(saved ? "Proyecto actualizado." : "No se han podido guardar los cambios.");
  };

  const addLink = () => {
    let url: URL;
    try { url = new URL(sourceValue); } catch { setNotice("Escribe una URL completa (https://…)."); return; }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      setNotice("Solo se admiten enlaces http o https.");
      return;
    }
    setSources((current) => [...current, {
      id: crypto.randomUUID(), kind: "link", name: sourceName.trim() || url.hostname,
      url: url.toString(), mimeType: null, size: null, excerpt: null, status: "ready",
      createdAt: new Date().toISOString(),
    }]);
    setSourceName(""); setSourceValue(""); setNotice("Enlace añadido. Guarda para aplicarlo al proyecto.");
  };

  const addNote = () => {
    const excerpt = sourceValue.trim();
    if (!excerpt) { setNotice("Escribe el contenido de la nota."); return; }
    setSources((current) => [...current, {
      id: crypto.randomUUID(), kind: "note", name: sourceName.trim() || "Nota de contexto",
      url: null, mimeType: "text/plain", size: new Blob([excerpt]).size,
      excerpt: excerpt.slice(0, 32_000), status: "ready", createdAt: new Date().toISOString(),
    }]);
    setSourceName(""); setSourceValue(""); setNotice("Nota añadida. Guarda para aplicarla al proyecto.");
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const additions: ProjectSource[] = [];
    for (const file of Array.from(files).slice(0, 10)) {
      if (file.size > 20_000_000) { setNotice(`${file.name} supera el límite de 20 MB.`); continue; }
      const textual = file.type.startsWith("text/") || /\.(md|txt|csv|json|xml|html?)$/i.test(file.name);
      const excerpt = textual ? (await readTextFile(file).catch(() => "")).slice(0, 32_000) : null;
      additions.push({
        id: crypto.randomUUID(), kind: "file", name: file.name, url: null,
        mimeType: file.type || "application/octet-stream", size: file.size, excerpt,
        status: excerpt ? "ready" : "pending-index", createdAt: new Date().toISOString(),
      });
    }
    if (additions.length) {
      setSources((current) => [...current, ...additions]);
      setNotice("Referencias añadidas. Solo se conserva el texto extraído; los binarios quedan pendientes de indexación.");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const addMember = () => {
    const email = memberEmail.trim().toLocaleLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setNotice("Escribe un correo válido."); return; }
    if (members.some((member) => member.email.toLocaleLowerCase() === email)) { setNotice("Esa persona ya está en el proyecto."); return; }
    setMembers((current) => [...current, {
      id: crypto.randomUUID(), email, name: null, role: memberRole,
      status: "invited-local", addedAt: new Date().toISOString(),
    }]);
    setVisibility("shared"); setMemberEmail("");
    setNotice("Acceso registrado localmente. La aplicación todavía no envía invitaciones por correo.");
  };

  return <AnimatePresence initial={false}>{open ? (
    <OverlayPresenceLayer key="project-panel" origin="right" rootRef={modalRef} tabIndex={-1} className="workspace-overlay fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Configurar proyecto" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      {(surfaceMotion) => <motion.aside {...surfaceMotion} className="workspace-panel flex h-full w-full max-w-[540px] flex-col border-l border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-popover)]">
        <header className="safe-area-panel-header workspace-panel-header flex items-center gap-3 border-b border-[var(--border-subtle)]">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--brain-accent-soft)] text-[var(--brain-accent-on-soft)]"><Brain size={18} /></span>
          <div className="min-w-0 flex-1"><h2 className="workspace-panel-title truncate">{project?.name ?? "Proyecto"}</h2><p className="workspace-panel-subtitle">{canEdit ? "Contexto compartido por todas sus conversaciones" : "Consulta del contexto compartido · solo lectura"}</p></div>
          <button ref={closeButtonRef} type="button" aria-label="Cerrar" className="touch-target rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]" onClick={onClose}><X size={17} /></button>
        </header>

        <nav className="flex gap-1 border-b border-[var(--border-subtle)] px-4 py-2" aria-label="Secciones del proyecto">
          {([['context', 'Contexto', Brain], ['sources', 'Fuentes', FileText], ['people', 'Personas', Users]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" aria-current={tab === id ? "page" : undefined} className={`flex min-h-9 items-center gap-2 rounded-xl px-3 text-[12px] font-medium ${tab === id ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"}`} onClick={() => setTab(id)}><Icon size={14} />{label}</button>
          ))}
        </nav>

        <div className="safe-area-panel-scroll scrollbar-thin min-h-0 flex-1 overflow-y-auto pt-5">
          {!canEdit ? <div className="mb-5 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-[11px] leading-5 text-[var(--text-secondary)]" role="status"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><span>Tienes acceso de solo lectura. Puedes consultar el contexto, las fuentes y las personas sin modificar el proyecto.</span></div> : null}
          {tab === "context" ? <div className="space-y-6">
            <section><label className="text-[12px] font-semibold" htmlFor="project-instructions">Instrucciones del proyecto</label><p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Define tono, objetivos y reglas. Se aplican de forma persistente a las nuevas respuestas.</p><textarea id="project-instructions" value={instructions} readOnly={!canEdit} maxLength={16_000} rows={7} className="mt-3 w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] leading-5 outline-none focus:border-[var(--brain-accent)] read-only:cursor-default" placeholder="Ej.: Responde en español, utiliza nuestros términos internos y señala siempre riesgos y próximos pasos." onChange={(event) => setInstructions(event.target.value)} /><p className="mt-1 text-right text-[10px] text-[var(--text-subtle)]">{instructions.length}/16.000</p></section>
            <section className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-center gap-3">
                <Brain size={17} className="text-[var(--brain-accent)]" />
                <div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">Memoria del proyecto</p><p className="text-[10px] text-[var(--text-muted)]">Solo usa lo que guardes explícitamente aquí.</p></div>
                <button type="button" role="switch" aria-label="Activar memoria del proyecto" aria-checked={memoryEnabled} disabled={!canEdit} className="touch-target grid place-items-center rounded-full disabled:cursor-default" onClick={() => setMemoryEnabled((value) => !value)}><span aria-hidden="true" className={`relative h-6 w-11 rounded-full transition ${memoryEnabled ? "bg-[var(--brain-accent)]" : "bg-[var(--surface-selected)]"}`}><span className={`absolute top-1 size-4 rounded-full transition ${memoryEnabled ? "left-6 bg-[var(--brain-contrast)]" : "left-1 bg-[var(--text-secondary)]"}`} /></span></button>
              </div>
              <label htmlFor="project-memory-notes" className="mt-4 block text-[11px] font-semibold text-[var(--text-secondary)]">Notas de memoria del proyecto</label>
              <textarea id="project-memory-notes" disabled={canEdit && !memoryEnabled} readOnly={!canEdit} value={memoryNotes} maxLength={16_000} rows={5} className="mt-2 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[12px] leading-5 outline-none disabled:opacity-45 read-only:cursor-default" placeholder="Decisiones, definiciones y preferencias que no deben perderse…" onChange={(event) => setMemoryNotes(event.target.value)} />
            </section>
          </div> : null}

          {tab === "sources" ? <div className="space-y-5">
            {canEdit ? <section className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex items-center gap-3"><UploadSimple size={18} /><div className="flex-1"><p className="text-[12px] font-semibold">Añadir referencias de archivo</p><p className="text-[10px] leading-4 text-[var(--text-muted)]">Se conserva como contexto el texto extraído (hasta 32 KB), no el archivo original. Los binarios se marcan como pendientes.</p></div><button type="button" className="touch-target rounded-xl border border-[var(--border)] px-3 py-2 text-[11px] font-semibold" onClick={() => fileRef.current?.click()}>Elegir archivos</button></div><input ref={fileRef} aria-label="Archivos de referencia" className="hidden" type="file" multiple onChange={(event) => void addFiles(event.target.files)} /></section> : null}
            {canEdit ? <section className="space-y-3">
              <label htmlFor="project-source-name" className="block text-[11px] font-semibold text-[var(--text-secondary)]">Nombre de la referencia <span className="font-normal text-[var(--text-muted)]">(opcional)</span></label>
              <input id="project-source-name" value={sourceName} maxLength={160} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[12px] outline-none" placeholder="Ej.: Manual de marca" onChange={(event) => setSourceName(event.target.value)} />
              <label htmlFor="project-source-value" className="block text-[11px] font-semibold text-[var(--text-secondary)]">URL o nota de contexto</label>
              <textarea id="project-source-value" value={sourceValue} maxLength={32_000} rows={3} className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[12px] outline-none" placeholder="Pega una URL o escribe una nota de contexto" onChange={(event) => setSourceValue(event.target.value)} />
              <div className="flex gap-2"><button type="button" className="touch-target flex min-h-9 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-[11px] font-semibold" onClick={addLink}><LinkSimple size={13} />Añadir enlace</button><button type="button" className="touch-target flex min-h-9 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-[11px] font-semibold" onClick={addNote}><Plus size={13} />Añadir nota</button></div>
            </section> : null}
            <section><h3 className="mb-2 text-[11px] font-semibold text-[var(--text-muted)]">{sources.length} fuente{sources.length === 1 ? "" : "s"}</h3><div className="space-y-2">{sources.map((source) => <div key={source.id} className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] p-3"><span className="mt-0.5 text-[var(--text-muted)]">{sourceIcon(source.kind)}</span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{source.name}</p><p className={`mt-0.5 text-[10px] ${source.status === "ready" ? "text-[var(--positive)]" : "text-[var(--warning)]"}`}>{source.status === "ready" ? "Lista para contexto" : "Guardada como referencia · indexación pendiente"}</p></div>{canEdit ? <button type="button" aria-label={`Eliminar ${source.name}`} className="touch-target rounded-lg p-1.5 text-[var(--text-subtle)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" onClick={() => setSources((current) => current.filter((item) => item.id !== source.id))}><Trash size={13} /></button> : null}</div>)}</div></section>
          </div> : null}

          {tab === "people" ? <div className="space-y-6">
            <section className="rounded-2xl border border-[var(--border)] p-4"><div className="flex items-start gap-3"><ShieldCheck size={18} className="mt-0.5 text-[var(--positive)]" /><div><p className="text-[12px] font-semibold">Compartición controlada</p><p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">{canManage ? "Los roles quedan guardados en esta instalación. El envío de invitaciones y el acceso remoto todavía no están conectados; no se mandará ningún correo." : "Solo el propietario puede cambiar la visibilidad y gestionar el acceso de otras personas."}</p></div></div><label className="mt-4 flex items-center justify-between gap-3 text-[11px] font-medium"><span>Visibilidad del proyecto</span><select value={visibility} disabled={!canManage} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 disabled:cursor-default disabled:opacity-100" onChange={(event) => setVisibility(event.target.value as "private" | "shared")}><option value="private">Privado</option><option value="shared">Compartido local</option></select></label></section>
            {canManage ? <section className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-[11px] font-semibold text-[var(--text-secondary)]">Correo de la persona<input value={memberEmail} type="email" className="mt-2 block w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[12px] font-normal text-[var(--text)]" placeholder="persona@empresa.com" onChange={(event) => setMemberEmail(event.target.value)} /></label>
              <label className="text-[11px] font-semibold text-[var(--text-secondary)]">Rol de la persona<select value={memberRole} className="mt-2 block min-h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px] font-normal text-[var(--text)]" onChange={(event) => setMemberRole(event.target.value as ProjectMemberRole)}><option value="viewer">Puede ver</option><option value="editor">Puede editar</option></select></label>
              <button type="button" className="touch-target min-h-10 rounded-xl bg-[var(--brain-accent)] px-3 text-[11px] font-semibold text-[var(--brain-contrast)]" onClick={addMember}>Añadir</button>
            </section> : null}
            <section className="space-y-2">{members.map((member) => <div key={member.id} className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] p-3"><span className="grid size-8 place-items-center rounded-full bg-[var(--surface-selected)] text-[11px] font-semibold">{member.email.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{member.email}</p><p className="text-[10px] text-[var(--text-muted)]">{member.status === "active" ? "Activo" : "Registrado localmente · sin enviar"}</p></div><select aria-label={`Rol de ${member.email}`} value={member.role === "owner" ? "viewer" : member.role} disabled={!canManage} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[10px] disabled:cursor-default disabled:opacity-100" onChange={(event) => setMembers((current) => current.map((item) => item.id === member.id ? { ...item, role: event.target.value as ProjectMemberRole } : item))}><option value="viewer">Ver</option><option value="editor">Editar</option></select>{canManage ? <button type="button" aria-label={`Quitar ${member.email}`} className="touch-target rounded-lg p-1.5 text-[var(--text-subtle)] hover:text-[var(--danger)]" onClick={() => setMembers((current) => current.filter((item) => item.id !== member.id))}><Trash size={13} /></button> : null}</div>)}</section>
          </div> : null}
        </div>

        <footer className="safe-area-panel-footer border-t border-[var(--border-subtle)] pt-4"><div className="flex items-center gap-3"><p className="min-w-0 flex-1 text-[10px] text-[var(--text-muted)]" aria-live="polite">{notice ?? (!canEdit ? "No puedes modificar este proyecto." : !canManage ? "Puedes editar el contexto y las fuentes; la compartición corresponde al propietario." : null)}</p>{canEdit ? <button type="button" disabled={busy || !project} className="flex min-h-10 items-center gap-2 rounded-xl bg-[var(--brain-accent)] px-4 text-[12px] font-semibold text-[var(--brain-contrast)] disabled:opacity-50" onClick={() => void save()}>{busy ? <SpinnerGap size={14} className="animate-spin" /> : null}Guardar cambios</button> : null}</div></footer>
      </motion.aside>}
    </OverlayPresenceLayer>
  ) : null}</AnimatePresence>;
}
