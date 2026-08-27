"use client";

import { useRef, useState } from "react";
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
} from "@/workbench/types";

type ProjectPanelProps = {
  project: WorkbenchProject | null;
  open: boolean;
  onClose: () => void;
  onSave: (patch: UpdateProjectInput) => Promise<boolean>;
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

export function ProjectPanel({ project, open, onClose, onSave }: ProjectPanelProps) {
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

  if (!open) return null;

  const save = async () => {
    if (!project) return;
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
      sharing: { visibility, members },
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
    setNotice("Acceso registrado localmente. AiBrain todavía no envía invitaciones por correo.");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label="Configurar proyecto" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <aside className="panel-enter flex h-full w-full max-w-[520px] flex-col border-l border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-popover)]">
        <header className="flex min-h-16 items-center gap-3 border-b border-[var(--border-subtle)] px-5">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--brain-accent-soft)] text-[var(--brain-accent-on-soft)]"><Brain size={18} /></span>
          <div className="min-w-0 flex-1"><h2 className="truncate text-[15px] font-semibold">{project?.name ?? "Proyecto"}</h2><p className="text-[11px] text-[var(--text-muted)]">Contexto compartido para todas sus conversaciones</p></div>
          <button type="button" aria-label="Cerrar" className="touch-target rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]" onClick={onClose}><X size={17} /></button>
        </header>

        <nav className="flex gap-1 border-b border-[var(--border-subtle)] px-4 py-2" aria-label="Secciones del proyecto">
          {([['context', 'Contexto', Brain], ['sources', 'Fuentes', FileText], ['people', 'Personas', Users]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" aria-current={tab === id ? "page" : undefined} className={`flex min-h-9 items-center gap-2 rounded-xl px-3 text-[12px] font-medium ${tab === id ? "bg-[var(--surface-selected)] text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"}`} onClick={() => setTab(id)}><Icon size={14} />{label}</button>
          ))}
        </nav>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "context" ? <div className="space-y-6">
            <section><label className="text-[12px] font-semibold" htmlFor="project-instructions">Instrucciones del proyecto</label><p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Define tono, objetivos y reglas. Se aplican de forma persistente a las nuevas respuestas.</p><textarea id="project-instructions" value={instructions} maxLength={16_000} rows={7} className="mt-3 w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] leading-5 outline-none focus:border-[var(--brain-accent)]" placeholder="Ej.: Responde en español, utiliza nuestros términos internos y señala siempre riesgos y próximos pasos." onChange={(event) => setInstructions(event.target.value)} /><p className="mt-1 text-right text-[10px] text-[var(--text-subtle)]">{instructions.length}/16.000</p></section>
            <section className="rounded-2xl border border-[var(--border)] p-4"><div className="flex items-center gap-3"><Brain size={17} className="text-[var(--brain-accent)]" /><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">Memoria del proyecto</p><p className="text-[10px] text-[var(--text-muted)]">Solo usa lo que guardes explícitamente aquí.</p></div><button type="button" role="switch" aria-checked={memoryEnabled} className={`relative h-6 w-11 rounded-full transition ${memoryEnabled ? "bg-[var(--brain-accent)]" : "bg-[var(--surface-selected)]"}`} onClick={() => setMemoryEnabled((value) => !value)}><span className={`absolute top-1 size-4 rounded-full bg-white transition ${memoryEnabled ? "left-6" : "left-1"}`} /></button></div><textarea disabled={!memoryEnabled} value={memoryNotes} maxLength={16_000} rows={5} className="mt-4 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[12px] leading-5 outline-none disabled:opacity-45" placeholder="Decisiones, definiciones y preferencias que no deben perderse…" onChange={(event) => setMemoryNotes(event.target.value)} /></section>
          </div> : null}

          {tab === "sources" ? <div className="space-y-5">
            <section className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex items-center gap-3"><UploadSimple size={18} /><div className="flex-1"><p className="text-[12px] font-semibold">Añadir referencias de archivo</p><p className="text-[10px] leading-4 text-[var(--text-muted)]">Se conserva como contexto el texto extraído (hasta 32 KB), no el archivo original. Los binarios se marcan como pendientes.</p></div><button type="button" className="rounded-xl border border-[var(--border)] px-3 py-2 text-[11px] font-semibold" onClick={() => fileRef.current?.click()}>Elegir</button></div><input ref={fileRef} className="hidden" type="file" multiple onChange={(event) => void addFiles(event.target.files)} /></section>
            <section className="space-y-2"><input value={sourceName} maxLength={160} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[12px] outline-none" placeholder="Nombre opcional" onChange={(event) => setSourceName(event.target.value)} /><textarea value={sourceValue} maxLength={32_000} rows={3} className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[12px] outline-none" placeholder="Pega una URL o escribe una nota de contexto" onChange={(event) => setSourceValue(event.target.value)} /><div className="flex gap-2"><button type="button" className="flex min-h-9 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-[11px] font-semibold" onClick={addLink}><LinkSimple size={13} />Añadir enlace</button><button type="button" className="flex min-h-9 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-[11px] font-semibold" onClick={addNote}><Plus size={13} />Añadir nota</button></div></section>
            <section><h3 className="mb-2 text-[11px] font-semibold text-[var(--text-muted)]">{sources.length} fuente{sources.length === 1 ? "" : "s"}</h3><div className="space-y-2">{sources.map((source) => <div key={source.id} className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] p-3"><span className="mt-0.5 text-[var(--text-muted)]">{sourceIcon(source.kind)}</span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{source.name}</p><p className={`mt-0.5 text-[10px] ${source.status === "ready" ? "text-[var(--positive)]" : "text-[var(--warning)]"}`}>{source.status === "ready" ? "Lista para contexto" : "Guardada como referencia · indexación pendiente"}</p></div><button type="button" aria-label={`Eliminar ${source.name}`} className="rounded-lg p-1.5 text-[var(--text-subtle)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" onClick={() => setSources((current) => current.filter((item) => item.id !== source.id))}><Trash size={13} /></button></div>)}</div></section>
          </div> : null}

          {tab === "people" ? <div className="space-y-6">
            <section className="rounded-2xl border border-[var(--border)] p-4"><div className="flex items-start gap-3"><ShieldCheck size={18} className="mt-0.5 text-[var(--positive)]" /><div><p className="text-[12px] font-semibold">Compartición controlada</p><p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">Los roles quedan guardados en esta instalación. El envío de invitaciones y el acceso remoto todavía no están conectados; no se mandará ningún correo.</p></div></div><label className="mt-4 flex items-center justify-between gap-3 text-[11px] font-medium"><span>Visibilidad del proyecto</span><select value={visibility} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2" onChange={(event) => setVisibility(event.target.value as "private" | "shared")}><option value="private">Privado</option><option value="shared">Compartido local</option></select></label></section>
            <section><div className="flex gap-2"><input value={memberEmail} type="email" className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[12px]" placeholder="persona@empresa.com" onChange={(event) => setMemberEmail(event.target.value)} /><select value={memberRole} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px]" onChange={(event) => setMemberRole(event.target.value as ProjectMemberRole)}><option value="viewer">Puede ver</option><option value="editor">Puede editar</option></select><button type="button" className="rounded-xl bg-[var(--brain-accent)] px-3 text-[11px] font-semibold text-[var(--brain-contrast)]" onClick={addMember}>Añadir</button></div></section>
            <section className="space-y-2">{members.map((member) => <div key={member.id} className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] p-3"><span className="grid size-8 place-items-center rounded-full bg-[var(--surface-selected)] text-[11px] font-semibold">{member.email.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{member.email}</p><p className="text-[10px] text-[var(--text-muted)]">{member.status === "active" ? "Activo" : "Registrado localmente · sin enviar"}</p></div><select value={member.role === "owner" ? "viewer" : member.role} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[10px]" onChange={(event) => setMembers((current) => current.map((item) => item.id === member.id ? { ...item, role: event.target.value as ProjectMemberRole } : item))}><option value="viewer">Ver</option><option value="editor">Editar</option></select><button type="button" aria-label={`Quitar ${member.email}`} className="rounded-lg p-1.5 text-[var(--text-subtle)] hover:text-[var(--danger)]" onClick={() => setMembers((current) => current.filter((item) => item.id !== member.id))}><Trash size={13} /></button></div>)}</section>
          </div> : null}
        </div>

        <footer className="border-t border-[var(--border-subtle)] px-5 py-4"><div className="flex items-center gap-3"><p className="min-w-0 flex-1 text-[10px] text-[var(--text-muted)]" aria-live="polite">{notice}</p><button type="button" disabled={busy || !project} className="flex min-h-10 items-center gap-2 rounded-xl bg-[var(--brain-accent)] px-4 text-[12px] font-semibold text-[var(--brain-contrast)] disabled:opacity-50" onClick={() => void save()}>{busy ? <SpinnerGap size={14} className="animate-spin" /> : null}Guardar cambios</button></div></footer>
      </aside>
    </div>
  );
}
