import { NextResponse, type NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const legacyMagicLinkPrefix = "/auth/confirm&";
  if (request.nextUrl.pathname.startsWith(legacyMagicLinkPrefix)) {
    const legacyParams = new URLSearchParams(
      request.nextUrl.pathname.slice(legacyMagicLinkPrefix.length),
    );
    const tokenHash = legacyParams.get("token_hash");
    const type = legacyParams.get("type");
    if (tokenHash && type) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/confirm";
      url.search = "";
      url.searchParams.set("token_hash", tokenHash);
      url.searchParams.set("type", type);
      return NextResponse.redirect(url, 307);
    }
  }
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
