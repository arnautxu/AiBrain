import "server-only";

import { createClient } from "@supabase/supabase-js";
import { readSupabasePublicConfig } from "@/lib/supabase/config";

export function isSupabaseAdminConfigured() {
  return Boolean(readSupabasePublicConfig() && process.env.SUPABASE_SECRET_KEY?.trim());
}

export function createSupabaseAdminClient() {
  const config = readSupabasePublicConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!config || !secretKey) {
    throw new Error("La configuració administrativa de Supabase no és completa.");
  }

  return createClient(config.url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
