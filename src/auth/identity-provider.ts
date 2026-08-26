export type IdentityCredentials = {
  accessToken: string;
  refreshToken: string;
};

export type VerifiedIdentity = IdentityCredentials & {
  userId: string;
  email: string;
};

export type RecoveryProof =
  | { code: string; tokenHash?: never }
  | { tokenHash: string; code?: never };

export interface AuthIdentityProvider {
  verifyPassword(email: string, password: string): Promise<VerifiedIdentity>;
  updatePassword(credentials: IdentityCredentials, newPassword: string): Promise<void>;
  requestPasswordRecovery(email: string, redirectTo: string): Promise<void>;
  verifyPasswordRecovery(proof: RecoveryProof): Promise<VerifiedIdentity>;
  signOut(credentials: IdentityCredentials): Promise<void>;
}

export class IdentityProviderError extends Error {
  readonly code: "invalid_credentials" | "invalid_recovery" | "provider_unavailable" | "provider_rejected";

  constructor(
    code: IdentityProviderError["code"],
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "IdentityProviderError";
    this.code = code;
  }
}
