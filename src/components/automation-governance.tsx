"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  Check,
  SpinnerGap,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import type {
  AutomationControlSnapshot,
  AutomationDefinition,
} from "@/lib/automation-contract";

function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={checked} disabled={disabled} className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-[#222320]" : "bg-[#d4d2cd]"} disabled:cursor-not-allowed disabled:opacity-45`} onClick={() => onChange(!checked)}>
      <span className={`absolute top-0.5 grid size-4 place-items-center rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}>{checked ? <Check size={8} weight="bold" /> : null}</span>
    </button>
  );
}

export function AutomationGovernance() {
  const [snapshot, setSnapshot] = useState<AutomationControlSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<AutomationDefinition["id"] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (signal?: AbortSignal) => {
    const response = await fetch("/api/control-plane/automations", { cache: "no-store", signal });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object" || !("automations" in body)) {
      throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "No s’ha pogut carregar la configuració.");
    }
    const next = body as AutomationControlSnapshot;
    setSnapshot(next);
    setError(null);
    setSelectedId((current) => next.automations.some((item) => item.id === current) ? current : next.automations[0]?.id ?? null);
  };

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      void load(controller.signal).catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Configuració no disponible.");
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, []);

  const selected = snapshot?.automations.find((item) => item.id === selectedId) ?? null;
  const permissionByMember = useMemo(() => new Map(
    (snapshot?.permissions ?? [])
      .filter((item) => item.automationId === selectedId)
      .map((item) => [item.userId, item.enabled]),
  ), [selectedId, snapshot?.permissions]);

  const update = async (payload: {
    scope: "tenant" | "member";
    automationId: AutomationDefinition["id"];
    enabled: boolean;
    userId?: string;
  }) => {
    const key = `${payload.scope}:${payload.automationId}:${payload.userId ?? "tenant"}`;
    setBusyKey(key);
    setError(null);
    try {
      const response = await fetch("/api/control-plane/automations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "No s’ha pogut desar el canvi.");
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No s’ha pogut desar el canvi.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="rounded-2xl border border-[#deddd8] bg-[#fbfbfa] p-5 md:p-7">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#efefec] text-[#56534e]"><ArrowClockwise size={17} /></span>
        <div>
          <h2 className="text-[12px] font-semibold">Automatitzacions de l’equip</h2>
          <p className="mt-1 max-w-[62ch] text-[9px] leading-4 text-[#918e88]">Activa només els processos aprovats i decideix quins treballadors poden executar cadascun. Els canvis queden auditats.</p>
        </div>
      </div>

      {!snapshot && !error ? <div className="mt-6 flex items-center gap-2 text-[9px] text-[#817e78]"><SpinnerGap size={12} className="animate-spin" />Carregant permisos…</div> : null}
      {error ? <div className="mt-5 flex items-start gap-2 rounded-xl border border-[#ead0c7] bg-[#fff8f5] p-3 text-[9px] leading-4 text-[#884b38]"><WarningCircle size={13} className="mt-0.5 shrink-0" />{error}</div> : null}

      {snapshot ? (
        <div className="mt-6 grid gap-5 md:grid-cols-[220px_1fr]">
          <nav className="space-y-1">
            {snapshot.automations.map((automation) => (
              <button key={automation.id} type="button" className={`w-full rounded-xl px-3 py-3 text-left transition ${selectedId === automation.id ? "bg-[#e9e8e4]" : "hover:bg-[#f0efec]"}`} onClick={() => setSelectedId(automation.id)}>
                <span className="flex items-center gap-2 text-[10px] font-semibold text-[#393733]"><span className={`size-1.5 rounded-full ${automation.enabled ? "bg-[#568060]" : "bg-[#bbb8b1]"}`} />{automation.name}</span>
                <span className="mt-1.5 block text-[8px] leading-4 text-[#8b8780]">{automation.enabled ? "Activa" : "Desactivada"}</span>
              </button>
            ))}
          </nav>

          {selected ? (
            <div className="min-w-0 rounded-xl border border-[#e1dfda] bg-white p-4">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1"><h3 className="text-[11px] font-semibold">{selected.name}</h3><p className="mt-1.5 text-[9px] leading-4 text-[#8a867f]">{selected.description}</p></div>
                <Switch label={`Activar ${selected.name} per a l’empresa`} checked={selected.enabled} disabled={busyKey !== null} onChange={(enabled) => void update({ scope: "tenant", automationId: selected.id, enabled })} />
              </div>

              <div className="mt-5 border-t border-[#e5e3de] pt-4">
                <p className="text-[9px] font-semibold text-[#6f6b65]">Qui la pot executar</p>
                {!selected.enabled ? <p className="mt-2 text-[9px] leading-4 text-[#99958e]">Activa primer l’automatització per poder donar accés als treballadors.</p> : snapshot.members.length === 0 ? <p className="mt-2 text-[9px] leading-4 text-[#99958e]">Encara no hi ha treballadors convidats.</p> : (
                  <div className="mt-3 divide-y divide-[#eceae6]">
                    {snapshot.members.map((member) => {
                      const key = `member:${selected.id}:${member.id}`;
                      return <div key={member.id} className="flex items-center gap-3 py-3"><UserCircle size={15} className="shrink-0 text-[#85817a]" /><div className="min-w-0 flex-1"><p className="truncate text-[9px] font-medium text-[#4d4a46]">{member.label}</p><p className="mt-0.5 text-[8px] text-[#9b9790]">Treballador</p></div>{busyKey === key ? <SpinnerGap size={12} className="animate-spin text-[#77736d]" /> : <Switch label={`Permetre ${selected.name} a ${member.label}`} checked={permissionByMember.get(member.id) === true} disabled={busyKey !== null} onChange={(enabled) => void update({ scope: "member", automationId: selected.id, userId: member.id, enabled })} />}</div>;
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
