import {
  CheckCircle,
  Code,
  HardDrives,
  ShieldCheck,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { AuthSession } from "@/auth/types";
import type { BrainManifest } from "@/config/brain";
import type { RuntimeStatus } from "@/lib/runtime-status";

export function RuntimePanel({
  manifest,
  session,
  status,
  onClose,
}: {
  manifest: BrainManifest;
  session: AuthSession;
  status: RuntimeStatus;
  onClose: () => void;
}) {
  return (
    <aside className="panel-enter fixed inset-y-0 right-0 z-30 flex w-full max-w-[390px] flex-col border-l border-[#deddd9] bg-[#f7f7f5] shadow-[-24px_0_48px_-40px_rgba(0,0,0,.45)] xl:static xl:max-w-[340px] xl:shadow-none">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#deddd9] px-4">
        <div className="flex items-center gap-2"><HardDrives size={14} className="text-[#706d68]" /><h2 className="text-[11px] font-semibold text-[#34322f]">Entorn del tenant</h2></div>
        <button aria-label="Tancar entorn" className="rounded-md p-1.5 text-[#77746f] hover:bg-[#ebeae6]" onClick={onClose}><X size={15} /></button>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="rounded-[var(--brain-radius)] border border-[#dfded9] bg-white p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--brain-accent-soft)] text-[var(--brain-accent)]"><Code size={16} weight="bold" /></span>
            <div className="min-w-0"><p className="truncate text-[11px] font-semibold">{manifest.identity.productName}</p><p className="mt-0.5 truncate text-[9px] text-[#918e88]">{session.tenant.name}</p></div>
          </div>
        </div>

        <section className="mt-6">
          <h3 className="text-[9px] font-semibold uppercase tracking-[.11em] text-[#918e88]">Runtime</h3>
          <div className="mt-3 divide-y divide-[#e5e3df] border-y border-[#e5e3df]">
            <RuntimeRow label="Connexió" value={status.ready ? "Codex connectat" : status.mode === "demo" ? "Mode demo" : "No disponible"} good={status.ready || status.mode === "demo"} />
            <RuntimeRow label="Procés" value={status.processWarm ? "App Server calent" : status.mode === "demo" ? "Simulat" : "Arrencada pendent"} good={status.processWarm} />
            <RuntimeRow label="Aïllament" value={status.isolated ? "CODEX_HOME propi" : "Encara no configurat"} good={status.isolated} />
            <RuntimeRow label="Projecte" value={status.projectName} />
            <RuntimeRow label="Workspace" value={status.workspaceName} />
            <RuntimeRow label="Sandbox" value={status.sandbox === "workspace-write" ? "Workspace write" : "Només lectura"} />
            <RuntimeRow label="Aprovacions" value={status.approvalPolicy === "on-request" ? "Interactives" : "Desactivades"} />
            {status.model ? <RuntimeRow label="Model" value={status.model} /> : null}
            <RuntimeRow label="Catàleg de models" value={status.models.length ? `${status.models.length} disponibles` : "Automàtic"} />
            <RuntimeRow label="Skills" value={status.skills.length ? `${status.skills.length} disponibles` : "Cap descoberta"} />
            {status.rateLimit ? <RuntimeRow label="Ús Codex" value={`${Math.round(status.rateLimit.usedPercent)}% de la finestra`} /> : null}
            {status.usage?.lifetimeTokens != null ? <RuntimeRow label="Tokens acumulats" value={new Intl.NumberFormat("ca-ES", { notation: "compact" }).format(status.usage.lifetimeTokens)} /> : null}
            <RuntimeRow label="Cerca web" value={status.capabilities.webSearch ? "Disponible" : status.mode === "demo" ? "Simulada a la preview" : "No disponible"} good={status.capabilities.webSearch} />
            <RuntimeRow label="Imatges" value={status.capabilities.imageInput ? "Entrada nativa" : status.mode === "demo" ? "Simulada a la preview" : "No disponibles"} good={status.capabilities.imageInput} />
            <RuntimeRow label="Generació" value={status.capabilities.imageGeneration ? "Imatges generatives" : status.mode === "demo" ? "Simulada a la preview" : "No disponible"} good={status.capabilities.imageGeneration} />
          </div>
        </section>

        <div className={`mt-6 flex items-start gap-2.5 rounded-[var(--brain-radius)] border p-3 ${status.isolated ? "border-[#d5e4d7] bg-[#f5faf5] text-[#496d50]" : "border-[#eadfc9] bg-[#fffaf0] text-[#7a602f]"}`}>
          {status.isolated ? <ShieldCheck size={15} className="mt-0.5 shrink-0" /> : <WarningCircle size={15} className="mt-0.5 shrink-0" />}
          <p className="text-[9px] leading-4">{status.isolated ? "Les credencials Codex es resolen des d’un directori privat d’aquest tenant." : "Apte per desenvolupament local. Abans de producció cal configurar CODEX_HOME_ROOT persistent i privat."}</p>
        </div>
      </div>
    </aside>
  );
}

function RuntimeRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1 text-[9px] text-[#85827c]">{label}</span><span className="flex items-center gap-1.5 text-right text-[9px] font-medium text-[#4b4844]">{good ? <CheckCircle size={11} className="text-[#568060]" /> : null}{value}</span></div>;
}
