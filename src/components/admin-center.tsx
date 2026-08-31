"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Check, Plus, ShieldCheck, SpinnerGap, Trash, UserPlus } from "@phosphor-icons/react";
import {
  isWorkspaceAdminSnapshot,
  type WorkspaceAdminCommand,
  type WorkspaceAdminSnapshot,
  type WorkspaceGroup,
  type WorkspacePolicy,
  type WorkspaceRoleId,
} from "@/admin/contracts";

const appLabels: Record<keyof WorkspacePolicy["apps"], string> = {
  "web-search": "Búsqueda web",
  "image-generation": "Imágenes",
  skills: "Skills",
  "managed-browser": "Navegador",
};
const capabilityLabels: Record<keyof WorkspacePolicy["capabilities"], string> = {
  consult: "Consultar",
  respond: "Responder",
  execute: "Ejecutar",
  publish: "Publicar",
};

export function AdminCenter() {
  const [snapshot, setSnapshot] = useState<WorkspaceAdminSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [newMember, setNewMember] = useState({ userId: "", displayName: "", email: "" });

  const loadSnapshot = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin", { cache: "no-store", signal });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isWorkspaceAdminSnapshot(value)) throw new Error("No se ha podido abrir el centro de administración.");
      if (!signal?.aborted) setSnapshot(value);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "No se ha podido cargar.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadSnapshot(controller.signal));
    return () => controller.abort();
  }, [loadSnapshot]);

  const run = async (command: WorkspaceAdminCommand, key: string) => {
    setBusy(key); setError(null);
    try {
      const response = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const result: unknown = await response.json().catch(() => null);
      const next = result && typeof result === "object" && "snapshot" in result ? result.snapshot : null;
      if (!response.ok || !isWorkspaceAdminSnapshot(next)) {
        const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
          ? result.error : "No se ha podido guardar el cambio.";
        throw new Error(message);
      }
      setSnapshot(next);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se ha podido guardar el cambio.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (loading && !snapshot) return <p role="status" aria-busy="true" className="text-[12px] text-[var(--text-subtle)]">Cargando administración…</p>;
  if (!snapshot) return <div role="alert" className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-[12px] text-[var(--danger)]"><p>{error ?? "Administración no disponible."}</p><button type="button" className="touch-target mt-3 min-h-9 rounded-lg border border-current px-3 font-semibold" onClick={() => void loadSnapshot()}>Reintentar</button></div>;

  const createGroup = () => {
    if (!name.trim()) return;
    void run({ action: "create-group", name: name.trim(), description: description.trim() }, "create-group").then((saved) => {
      if (saved) { setName(""); setDescription(""); }
    });
  };
  const provision = () => {
    if (!newMember.userId || !newMember.displayName || !newMember.email) return;
    void run({ action: "provision-local-member", ...newMember }, "provision-member").then((saved) => {
      if (saved) setNewMember({ userId: "", displayName: "", email: "" });
    });
  };

  return <div className="admin-center space-y-8">
    <section>
      <div className="flex items-start gap-3 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <ShieldCheck size={19} className="mt-0.5 text-[var(--positive)]" />
        <div><h3 className="text-[12px] font-semibold">Centro de administración</h3><p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">Solo propietario y administradores pueden acceder. Todos los cambios quedan en el registro de auditoría de {snapshot.companyName}.</p></div>
      </div>
      {error ? <p className="mt-3 rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-[10px] text-[var(--danger)]" role="alert">{error}</p> : null}
    </section>

    <section>
      <h3 className="mb-1 text-[12px] font-semibold">Personas, roles y workers</h3>
      <p className="mb-4 text-[10px] leading-4 text-[var(--text-muted)]">El uso mostrado procede de los turnos guardados en esta instalación; el estado del worker no lo inicia.</p>
      <div className="divide-y divide-[var(--border-subtle)] rounded-[16px] border border-[var(--border)]">
        {snapshot.members.map((member) => <div key={member.userId} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-center">
          <div className="min-w-0"><p className="truncate text-[12px] font-semibold">{member.displayName}</p><p className="truncate text-[10px] text-[var(--text-muted)]">{member.email}</p><p className="mt-1 text-[9px] text-[var(--text-subtle)]">{member.workerId} · {member.workerHealthy ? "worker operativo" : `worker ${member.workerState}`} · {member.usage.turns} turnos</p></div>
          <select aria-label={`Rol de ${member.displayName}`} value={member.roleId} disabled={busy !== null} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-[10px]" onChange={(event) => void run({ action: "set-member-role", userId: member.userId, roleId: event.target.value as WorkspaceRoleId }, `role:${member.userId}`)}>{snapshot.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
          <button type="button" disabled={busy !== null} className={`touch-target min-h-8 rounded-lg px-3 text-[10px] font-semibold ${member.enabled ? "border border-[var(--border)]" : "bg-[var(--brain-accent)] text-[var(--brain-contrast)]"}`} onClick={() => void run({ action: "set-member-enabled", userId: member.userId, enabled: !member.enabled }, `enabled:${member.userId}`)}>{busy === `enabled:${member.userId}` ? <SpinnerGap size={12} className="mx-auto motion-safe:animate-spin" /> : member.enabled ? "Desactivar" : "Activar"}</button>
        </div>)}
      </div>
    </section>

    <section>
      <h3 className="mb-1 text-[12px] font-semibold">Alta local</h3>
      <p className="mb-3 text-[10px] leading-4 text-[var(--text-muted)]">{snapshot.identityProvisioning.detail} No se enviará ningún correo.</p>
      <div className="grid gap-2 rounded-[16px] border border-[var(--border)] p-4 sm:grid-cols-2">
        <label className="block" htmlFor="admin-member-name">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-muted)]">Nombre</span>
          <input id="admin-member-name" value={newMember.displayName} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px]" autoComplete="name" onChange={(event) => setNewMember((value) => ({ ...value, displayName: event.target.value }))} />
        </label>
        <label className="block" htmlFor="admin-member-email">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-muted)]">Correo</span>
          <input id="admin-member-email" value={newMember.email} type="email" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px]" placeholder="persona@empresa.com" autoComplete="email" onChange={(event) => setNewMember((value) => ({ ...value, email: event.target.value.toLocaleLowerCase() }))} />
        </label>
        <label className="block sm:col-span-2" htmlFor="admin-member-user-id">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-muted)]">Identificador del proveedor</span>
          <input id="admin-member-user-id" value={newMember.userId} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-[10px]" placeholder="UUID existente" autoComplete="off" onChange={(event) => setNewMember((value) => ({ ...value, userId: event.target.value.toLocaleLowerCase() }))} />
        </label>
        <button type="button" disabled={busy !== null} className="touch-target flex min-h-9 items-center justify-center gap-2 rounded-lg bg-[var(--brain-accent)] px-3 text-[10px] font-semibold text-[var(--brain-contrast)] sm:col-span-2" onClick={provision}>{busy === "provision-member" ? <SpinnerGap size={13} className="motion-safe:animate-spin" /> : <UserPlus size={13} />}Crear perfil y worker local</button>
      </div>
    </section>

    <section>
      <h3 className="mb-1 text-[12px] font-semibold">Grupos y políticas</h3>
      <p className="mb-4 text-[10px] leading-4 text-[var(--text-muted)]">Las restricciones de grupo se combinan con el rol y siempre prevalece el bloqueo. Afectan al runtime y a las apps publicadas.</p>
      <div className="mb-4 grid gap-2 rounded-[16px] border border-dashed border-[var(--border)] p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block" htmlFor="admin-group-name">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-muted)]">Nombre del grupo</span>
          <input id="admin-group-name" value={name} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px]" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block" htmlFor="admin-group-description">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-muted)]">Descripción</span>
          <input id="admin-group-description" value={description} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px]" onChange={(event) => setDescription(event.target.value)} />
        </label>
        <button type="button" disabled={busy !== null || !name.trim()} className="touch-target flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 text-[10px] font-semibold" onClick={createGroup}><Plus size={12} />Crear</button>
      </div>
      <div className="space-y-3">{snapshot.groups.map((group) => <GroupCard key={group.id} group={group} snapshot={snapshot} busy={busy !== null} onSave={(next) => void run({ action: "update-group", groupId: next.id, name: next.name, description: next.description, memberIds: next.memberIds, policy: next.policy }, `group:${next.id}`)} onDelete={() => void run({ action: "delete-group", groupId: group.id }, `delete:${group.id}`)} />)}{snapshot.groups.length === 0 ? <p className="rounded-[16px] border border-[var(--border-subtle)] p-4 text-[11px] text-[var(--text-subtle)]">Todavía no hay grupos. Los miembros usan únicamente la política de su rol.</p> : null}</div>
    </section>

    <SkillAdministration snapshot={snapshot} />

    <section>
      <h3 className="mb-3 text-[12px] font-semibold">Registro de auditoría</h3>
      <div className="divide-y divide-[var(--border-subtle)] rounded-[16px] border border-[var(--border)]">{snapshot.audit.map((event) => <div key={event.sequence} className="px-4 py-3"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold">{event.action}</p><time className="text-[9px] text-[var(--text-subtle)]">{new Date(event.occurredAt).toLocaleString("es-ES")}</time></div><p className="mt-1 text-[10px] text-[var(--text-muted)]">{event.summary}</p><p className="mt-1 font-mono text-[8px] text-[var(--text-subtle)]">actor {event.actorUserId}</p></div>)}{snapshot.audit.length === 0 ? <p className="p-4 text-[11px] text-[var(--text-subtle)]">No hay cambios administrativos registrados.</p> : null}</div>
    </section>
  </div>;
}

type CatalogPackageView = { id: string; label: string; version: string; source: "versioned" | "company"; status: "active" | "revoked"; provenance: string };

function SkillAdministration({ snapshot }: { snapshot: WorkspaceAdminSnapshot }) {
  const [packages, setPackages] = useState<CatalogPackageView[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ id: "", label: "", version: "1.0.0", provenance: "Información confirmada por el administrador de la empresa.", description: "", instructions: "", scope: "installation", subjectId: "" });
  const fieldId = useId();
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const response = await fetch("/api/admin/catalog", { cache: "no-store", signal });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object" || !("packages" in body) || !Array.isArray(body.packages)) throw new Error("No se ha podido cargar el catálogo de skills.");
      if (!signal?.aborted) setPackages((body.packages as CatalogPackageView[]).filter((item) => item && typeof item.id === "string"));
      return true;
    } catch (error) {
      if (!signal?.aborted) setCatalogError(error instanceof Error ? error.message : "Catálogo no disponible.");
      return false;
    } finally {
      if (!signal?.aborted) setCatalogLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [refresh]);
  const subjectOptions = draft.scope === "role" ? snapshot.roles.map((item) => ({ id: item.id, label: item.name })) : draft.scope === "group" ? snapshot.groups.map((item) => ({ id: item.id, label: item.name })) : draft.scope === "user" ? snapshot.members.map((item) => ({ id: item.userId, label: item.displayName })) : [];
  const save = async () => {
    if (!draft.id || !draft.label || !draft.description || !draft.instructions || (draft.scope !== "installation" && !draft.subjectId)) return;
    setSaving(true); setMessage(null); setMessageIsError(false);
    try {
      const skillContent = `---\nname: ${draft.id}\ndescription: ${draft.description}\n---\n\n# ${draft.label}\n\n${draft.instructions.trim()}\n`;
      const first = await fetch("/api/admin/catalog", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upsert-skill-package", package: { id: draft.id, label: draft.label, version: draft.version, category: "company", provenance: draft.provenance, files: [{ path: "SKILL.md", content: skillContent }] } }) });
      if (!first.ok) throw new Error(((await first.json().catch(() => null)) as { error?: string } | null)?.error ?? "No se ha podido guardar la skill.");
      const subjectId = draft.scope === "installation" ? null : draft.subjectId;
      const second = await fetch("/api/admin/catalog", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-rule", rule: { id: `admin:${draft.scope}:${subjectId ?? "all"}:${draft.id}`, scope: draft.scope, subjectId, resourceId: draft.id, effect: "allow", operations: ["read"] } }) });
      if (!second.ok) throw new Error(((await second.json().catch(() => null)) as { error?: string } | null)?.error ?? "La skill se guardó, pero no se pudo asignar.");
      if (!await refresh()) throw new Error("La skill se guardó, pero no se pudo actualizar el catálogo visible.");
      setMessageIsError(false);
      setMessage("Skill versionada y asignada. Se sincronizará de forma privada en el próximo turno de cada persona autorizada.");
      setDraft((value) => ({ ...value, id: "", label: "", description: "", instructions: "" }));
    } catch (error) { setMessageIsError(true); setMessage(error instanceof Error ? error.message : "No se ha podido guardar."); } finally { setSaving(false); }
  };
  const revoke = async (skillId: string) => {
    setSaving(true); setMessage(null); setMessageIsError(false);
    try {
      const response = await fetch("/api/admin/catalog", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke-skill-package", skillId }) });
      if (!response.ok) throw new Error("No se ha podido revocar la skill.");
      if (!await refresh()) throw new Error("La skill se revocó, pero no se pudo actualizar el catálogo visible.");
      setMessageIsError(false);
      setMessage("Skill revocada. Desaparecerá de cada CODEX_HOME privado en su siguiente sincronización.");
    } catch (error) { setMessageIsError(true); setMessage(error instanceof Error ? error.message : "No se ha podido revocar."); }
    finally { setSaving(false); }
  };
  const validDraft = Boolean(draft.id && draft.label && draft.description && draft.instructions && (draft.scope === "installation" || draft.subjectId));
  const fieldClass = "mt-1.5 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[10px]";
  const labelClass = "block text-[10px] font-medium text-[var(--text-muted)]";
  return <section>
    <h3 className="mb-1 text-[12px] font-semibold">Skills gestionadas</h3>
    <p className="mb-4 text-[10px] leading-4 text-[var(--text-muted)]">Solo administración puede crear, versionar, asignar o revocar. El contenido no debe incluir secretos.</p>
    {message ? <p role={messageIsError ? "alert" : "status"} className={`mb-3 rounded-lg px-3 py-2 text-[10px] ${messageIsError ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-muted)]"}`}>{message}</p> : null}
    {catalogLoading && !packages.length ? <p role="status" aria-busy="true" className="flex min-h-24 items-center justify-center gap-2 text-[11px] text-[var(--text-muted)]"><SpinnerGap size={14} className="motion-safe:animate-spin" />Cargando catálogo de skills…</p> : catalogError && !packages.length ? <div role="alert" className="rounded-xl bg-[var(--danger-soft)] p-3 text-[11px] text-[var(--danger)]"><p>{catalogError}</p><button type="button" className="touch-target mt-2 min-h-9 rounded-lg border border-current px-3 font-semibold" onClick={() => void refresh()}>Reintentar</button></div> : <>
      {catalogError ? <div role="alert" className="mb-3 rounded-xl bg-[var(--danger-soft)] p-3 text-[11px] text-[var(--danger)]"><p>{catalogError}</p><button type="button" className="touch-target mt-2 min-h-9 rounded-lg border border-current px-3 font-semibold" onClick={() => void refresh()}>Reintentar</button></div> : null}
      <div className="space-y-2">{packages.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2"><div><p className="text-[11px] font-semibold">{item.label} <span className="font-mono text-[9px] text-[var(--text-subtle)]">{item.id}@{item.version}</span></p><p className="mt-1 text-[9px] text-[var(--text-muted)]">{item.source === "versioned" ? "GraphikAI versionada" : "Empresa"} · {item.status === "active" ? "activa" : "revocada"}</p></div>{item.source === "company" && item.status === "active" ? <button type="button" disabled={saving} onClick={() => void revoke(item.id)} className="touch-target min-h-8 rounded-lg px-2 py-1 text-[10px] text-[var(--danger)]">Revocar</button> : null}</div>)}</div>
      {!catalogLoading && !packages.length ? <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-[11px] text-[var(--text-subtle)]">No hay skills publicadas en este catálogo.</p> : null}
    </>}
    <div className="mt-4 grid gap-3 rounded-[16px] border border-dashed border-[var(--border)] p-4 sm:grid-cols-2">
      <label htmlFor={`${fieldId}-skill-id`} className={labelClass}>Identificador de la skill<input id={`${fieldId}-skill-id`} value={draft.id} placeholder="id-de-la-skill" onChange={(event) => setDraft((value) => ({ ...value, id: event.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, "") }))} className={fieldClass} /></label>
      <label htmlFor={`${fieldId}-skill-label`} className={labelClass}>Nombre visible<input id={`${fieldId}-skill-label`} value={draft.label} placeholder="Nombre visible" onChange={(event) => setDraft((value) => ({ ...value, label: event.target.value }))} className={fieldClass} /></label>
      <label htmlFor={`${fieldId}-skill-version`} className={labelClass}>Versión<input id={`${fieldId}-skill-version`} value={draft.version} placeholder="1.0.0" onChange={(event) => setDraft((value) => ({ ...value, version: event.target.value }))} className={fieldClass} /></label>
      <label htmlFor={`${fieldId}-skill-description`} className={labelClass}>Cuándo debe usarse<input id={`${fieldId}-skill-description`} value={draft.description} placeholder="Describe el contexto de uso" onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} className={fieldClass} /></label>
      <label htmlFor={`${fieldId}-skill-instructions`} className={`${labelClass} sm:col-span-2`}>Instrucciones confirmadas<textarea id={`${fieldId}-skill-instructions`} value={draft.instructions} rows={4} placeholder="Sin secretos" onChange={(event) => setDraft((value) => ({ ...value, instructions: event.target.value }))} className={fieldClass} /></label>
      <label htmlFor={`${fieldId}-skill-provenance`} className={`${labelClass} sm:col-span-2`}>Procedencia y fecha de confirmación<input id={`${fieldId}-skill-provenance`} value={draft.provenance} placeholder="Fuente confirmada" onChange={(event) => setDraft((value) => ({ ...value, provenance: event.target.value }))} className={fieldClass} /></label>
      <label htmlFor={`${fieldId}-skill-scope`} className={labelClass}>Audiencia<select id={`${fieldId}-skill-scope`} value={draft.scope} onChange={(event) => setDraft((value) => ({ ...value, scope: event.target.value, subjectId: "" }))} className={fieldClass}><option value="installation">Toda la empresa</option><option value="role">Rol</option><option value="group">Grupo</option><option value="user">Persona</option></select></label>
      {draft.scope === "installation" ? <div /> : <label htmlFor={`${fieldId}-skill-subject`} className={labelClass}>Asignar a<select id={`${fieldId}-skill-subject`} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))} className={fieldClass}><option value="">Selecciona</option>{subjectOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      <button type="button" disabled={saving || !validDraft} onClick={() => void save()} className="touch-target min-h-9 rounded-lg bg-[var(--brain-accent)] text-[10px] font-semibold text-[var(--brain-contrast)] disabled:opacity-40 sm:col-span-2">{saving ? "Guardando…" : "Guardar y asignar skill"}</button>
    </div>
  </section>;
}

function GroupCard({ group, snapshot, busy, onSave, onDelete }: { group: WorkspaceGroup; snapshot: WorkspaceAdminSnapshot; busy: boolean; onSave: (group: WorkspaceGroup) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(group);
  const fieldId = useId();
  const updatePolicy = <Section extends keyof WorkspacePolicy>(section: Section, key: keyof WorkspacePolicy[Section], enabled: boolean) => setDraft((value) => ({ ...value, policy: { ...value.policy, [section]: { ...value.policy[section], [key]: enabled } } }));
  return <article className="rounded-[16px] border border-[var(--border)] p-4">
    <div className="flex items-end gap-2">
      <label className="min-w-0 flex-1" htmlFor={`${fieldId}-name`}>
        <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-muted)]">Nombre del grupo</span>
        <input id={`${fieldId}-name`} value={draft.name} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] font-semibold" onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} />
      </label>
      <button type="button" aria-label={`Eliminar ${group.name}`} disabled={busy} className="touch-target grid size-8 place-items-center rounded-lg text-[var(--danger)] hover:bg-[var(--danger-soft)]" onClick={onDelete}><Trash size={14} /></button>
    </div>
    <label className="mt-2 block" htmlFor={`${fieldId}-description`}>
      <span className="mb-1.5 block text-[10px] font-medium text-[var(--text-muted)]">Descripción</span>
      <input id={`${fieldId}-description`} value={draft.description} className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-[10px]" onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} />
    </label>
    <p className="mb-2 mt-4 text-[10px] font-semibold">Miembros</p><div className="flex flex-wrap gap-2">{snapshot.members.map((member) => { const selected = draft.memberIds.includes(member.userId); return <button key={member.userId} type="button" aria-pressed={selected} className={`touch-target flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[9px] ${selected ? "bg-[var(--brain-accent-soft)] text-[var(--brain-accent-on-soft)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`} onClick={() => setDraft((value) => ({ ...value, memberIds: selected ? value.memberIds.filter((id) => id !== member.userId) : [...value.memberIds, member.userId] }))}>{selected ? <Check size={9} /> : null}{member.displayName}</button>; })}</div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><PolicyList title="Apps" values={draft.policy.apps} labels={appLabels} onChange={(key, enabled) => updatePolicy("apps", key, enabled)} /><PolicyList title="Capacidades" values={draft.policy.capabilities} labels={capabilityLabels} onChange={(key, enabled) => updatePolicy("capabilities", key, enabled)} /></div>
    <button type="button" disabled={busy || !draft.name.trim()} className="touch-target mt-4 min-h-9 w-full rounded-lg bg-[var(--brain-accent)] text-[10px] font-semibold text-[var(--brain-contrast)] disabled:opacity-50" onClick={() => onSave({ ...draft, updatedAt: new Date().toISOString() })}>Guardar grupo</button>
  </article>;
}

function PolicyList<Key extends string>({ title, values, labels, onChange }: { title: string; values: Record<Key, boolean>; labels: Record<Key, string>; onChange: (key: Key, enabled: boolean) => void }) {
  return <div><p className="mb-2 text-[10px] font-semibold">{title}</p><div className="space-y-1">{(Object.keys(values) as Key[]).map((key) => <label key={key} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-muted)] px-2.5 py-2 text-[9px]"><span>{labels[key]}</span><input type="checkbox" checked={values[key]} onChange={(event) => onChange(key, event.target.checked)} /></label>)}</div></div>;
}
