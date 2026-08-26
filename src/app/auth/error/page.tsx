import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

export default function AuthErrorPage() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f2f3f0] px-5 text-[#292825]">
      <section className="w-full max-w-[440px] rounded-[24px] border border-[#ddded9] bg-[#fbfbfa] p-8 text-center shadow-[0_28px_80px_-54px_rgba(30,34,29,.55)]">
        <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[#fff1ec] text-[#98543c]">
          <WarningCircle size={20} />
        </span>
        <h1 className="mt-6 text-[24px] font-semibold tracking-[-.04em]">No hem pogut validar l’accés</h1>
        <p className="mt-3 text-[11px] leading-5 text-[#77746e]">
          L’enllaç pot haver caducat, ja s’ha utilitzat o aquest compte encara no té cap tenant assignat.
        </p>
        <Link href="/login" className="mt-7 inline-flex rounded-lg bg-[#222320] px-4 py-2.5 text-[10px] font-semibold text-white">
          Tornar a l’accés
        </Link>
      </section>
    </main>
  );
}
