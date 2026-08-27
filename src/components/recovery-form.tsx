"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicInstallationBranding } from "@/config/installation-branding";

export function RecoveryForm({
  branding,
  proof,
}: {
  branding: PublicInstallationBranding;
  proof: { code: string } | { tokenHash: string } | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.history.replaceState(null, "", "/auth/recovery");
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proof) return;
    setLoading(true);
    setError(null);
    const response = await fetch("/api/auth/password/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...proof, password, confirmation }),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setError(result && typeof result === "object" && "error" in result &&
        typeof result.error === "string" ? result.error : "No s’ha pogut recuperar l’accés.");
      setLoading(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f2f3f0] px-5 py-8 text-[#252522]">
      <section className="w-full max-w-md rounded-[26px] border border-[#ddded9] bg-[#fbfbfa] p-8 shadow-[0_32px_90px_-56px_rgba(30,34,29,.55)]">
        <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#77746e]">{branding.productName}</p>
        <h1 className="mt-4 text-[28px] font-semibold tracking-[-.045em]">Crea una contrasenya nova</h1>
        {!proof ? (
          <p role="alert" className="mt-5 rounded-xl bg-[#fff3ee] px-4 py-3 text-[10px] text-[#8b4e39]">
            L’enllaç de recuperació no és vàlid o ha caducat.
          </p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
            <input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contrasenya nova" className="w-full rounded-xl border border-[#d9d7d2] bg-white px-3.5 py-3 text-[11px] outline-none" />
            <input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repeteix la contrasenya" className="w-full rounded-xl border border-[#d9d7d2] bg-white px-3.5 py-3 text-[11px] outline-none" />
            <button disabled={loading} style={{ backgroundColor: branding.accentColor }} className="w-full rounded-xl px-4 py-3 text-[10px] font-semibold text-white disabled:opacity-55">{loading ? "Actualitzant…" : "Actualitza i entra"}</button>
          </form>
        )}
        {error ? <p role="alert" className="mt-4 text-[10px] text-[#8b4e39]">{error}</p> : null}
      </section>
    </main>
  );
}
