import "server-only";

import {
  createClient,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
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
import { validatedAvatarUrl } from "@/auth/avatar-url";

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
    user: { id?: string; email?: string; user_metadata?: Record<string, unknown> | null } | null;
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
  const metadata = data.user?.user_metadata;
  const avatarUrl = validatedAvatarUrl(metadata?.avatar_url ?? metadata?.picture ?? metadata?.avatar);
  return { userId, email, accessToken, refreshToken, avatarUrl };
}

function providerFailure(
  error: unknown,
  rejectedCode: "invalid_credentials" | "invalid_recovery" | "provider_rejected",
) {
  if (error instanceof IdentityProviderError) return error;
  if (
    isAuthRetryableFetchError(error) ||
    error instanceof TypeError ||
    (error && typeof error === "object" && "cause" in error)
  ) {
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

async function updatePasswordWithAccessToken(
  config: SupabasePublicConfig,
  accessToken: string,
  newPassword: string,
) {
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: newPassword }),
      cache: "no-store",
    });
  } catch (error) {
    throw providerFailure(error, "provider_rejected");
  }
  if (response.status >= 500) {
    throw new IdentityProviderError(
      "provider_unavailable",
      "Identity provider is unavailable.",
    );
  }
  if (!response.ok) {
    throw new IdentityProviderError(
      "provider_rejected",
      "Identity provider rejected the request.",
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") {
    throw new IdentityProviderError(
      "provider_rejected",
      "Identity provider returned an invalid password-update response.",
    );
  }
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
    // A password-change challenge is deliberately shorter than the provider's
    // access-token lifetime. Use that token directly instead of calling
    // setSession(), which refreshes and rotates the stored refresh token before
    // the update and can invalidate an otherwise fresh one-time challenge.
    await updatePasswordWithAccessToken(this.config, credentials.accessToken, newPassword);
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
