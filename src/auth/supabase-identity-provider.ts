import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  IdentityProviderError,
  type AuthIdentityProvider,
  type IdentityCredentials,
  type RecoveryProof,
  type VerifiedIdentity,
} from "@/auth/identity-provider";
import {
  readSupabasePublicConfig,
  type SupabasePublicConfig,
} from "@/lib/supabase/config";

function isolatedClient(config: SupabasePublicConfig) {
  return createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function normalizeIdentity(
  data: {
    user: { id?: string; email?: string } | null;
    session: { access_token?: string; refresh_token?: string } | null;
  },
  errorCode: "invalid_credentials" | "invalid_recovery",
): VerifiedIdentity {
  const userId = data.user?.id;
  const email = data.user?.email?.trim().toLowerCase();
  const accessToken = data.session?.access_token;
  const refreshToken = data.session?.refresh_token;
  if (!userId || !email || !accessToken || !refreshToken) {
    throw new IdentityProviderError(errorCode, "Identity provider did not return a complete session.");
  }
  return { userId, email, accessToken, refreshToken };
}

function providerFailure(
  error: unknown,
  rejectedCode: "invalid_credentials" | "invalid_recovery" | "provider_rejected",
) {
  if (error instanceof IdentityProviderError) return error;
  if (error instanceof TypeError || (error && typeof error === "object" && "cause" in error)) {
    return new IdentityProviderError(
      "provider_unavailable",
      "Identity provider is unavailable.",
      { cause: error },
    );
  }
  return new IdentityProviderError(rejectedCode, "Identity provider rejected the request.", {
    cause: error,
  });
}

async function setCredentials(client: SupabaseClient, credentials: IdentityCredentials) {
  const { error } = await client.auth.setSession({
    access_token: credentials.accessToken,
    refresh_token: credentials.refreshToken,
  });
  if (error) throw error;
}

export class SupabaseAuthIdentityProvider implements AuthIdentityProvider {
  private readonly config: SupabasePublicConfig;

  constructor(config: SupabasePublicConfig) {
    this.config = config;
  }

  async verifyPassword(email: string, password: string) {
    try {
      const client = isolatedClient(this.config);
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return normalizeIdentity(data, "invalid_credentials");
    } catch (error) {
      throw providerFailure(error, "invalid_credentials");
    }
  }

  async updatePassword(credentials: IdentityCredentials, newPassword: string) {
    try {
      const client = isolatedClient(this.config);
      await setCredentials(client, credentials);
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    } catch (error) {
      throw providerFailure(error, "provider_rejected");
    }
  }

  async requestPasswordRecovery(email: string, redirectTo: string) {
    try {
      const client = isolatedClient(this.config);
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
    } catch (error) {
      throw providerFailure(error, "provider_rejected");
    }
  }

  async verifyPasswordRecovery(proof: RecoveryProof) {
    try {
      const client = isolatedClient(this.config);
      if (proof.tokenHash) {
        const { data, error } = await client.auth.verifyOtp({
          token_hash: proof.tokenHash,
          type: "recovery",
        });
        if (error) throw error;
        return normalizeIdentity(data, "invalid_recovery");
      }
      const { data, error } = await client.auth.exchangeCodeForSession(proof.code!);
      if (error) throw error;
      return normalizeIdentity(data, "invalid_recovery");
    } catch (error) {
      throw providerFailure(error, "invalid_recovery");
    }
  }

  async signOut(credentials: IdentityCredentials) {
    try {
      const client = isolatedClient(this.config);
      await setCredentials(client, credentials);
      await client.auth.signOut({ scope: "local" });
    } catch {
      // Tokens never leave the server. Failing to revoke a provider refresh
      // token must not make the already-created local workbench session depend
      // on provider availability.
    }
  }
}

export function createSupabaseAuthIdentityProvider() {
  const config = readSupabasePublicConfig();
  if (!config) throw new IdentityProviderError(
    "provider_unavailable",
    "Supabase Auth configuration is incomplete.",
  );
  return new SupabaseAuthIdentityProvider(config);
}
