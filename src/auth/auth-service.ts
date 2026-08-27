import type {
  AuthIdentityProvider,
  IdentityCredentials,
  RecoveryProof,
} from "@/auth/identity-provider";
import type { FileLocalAuthChallengeStore } from "@/auth/local-auth-challenge-store";
import type { CreatedLocalSession, FileLocalSessionStore } from "@/auth/local-session-store";
import type { FileLocalUserStore, LocalUser } from "@/auth/local-user-store";

export class LocalAuthError extends Error {
  readonly code:
    | "invalid_input"
    | "invalid_credentials"
    | "profile_unavailable"
    | "profile_disabled"
    | "challenge_invalid"
    | "recovery_invalid";

  constructor(code: LocalAuthError["code"], message: string) {
    super(message);
    this.name = "LocalAuthError";
    this.code = code;
  }
}

export type SuccessfulLocalAuthentication = {
  kind: "authenticated";
  user: LocalUser;
  session: CreatedLocalSession;
};

export type InitialPasswordChallenge = {
  kind: "password_change_required";
  challengeId: string;
  expiresAt: number;
};

function normalizedEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new LocalAuthError("invalid_input", "Email address is invalid.");
  }
  return email;
}

export function validatePassword(value: string) {
  if (
    value.length < 12 ||
    value.length > 128 ||
    !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(value) ||
    !/[0-9]/.test(value)
  ) {
    throw new LocalAuthError(
      "invalid_input",
      "Password must have 12–128 characters and include a letter and a number.",
    );
  }
  return value;
}

export class LocalAuthService {
  constructor(
    readonly installationId: string,
    private readonly identityProvider: AuthIdentityProvider,
    private readonly users: FileLocalUserStore,
    private readonly sessions: FileLocalSessionStore,
    private readonly challenges: FileLocalAuthChallengeStore,
  ) {}

  private async authorizedLocalUser(userId: string, identityEmail: string) {
    const user = await this.users.read(userId);
    if (!user || user.email !== identityEmail) {
      throw new LocalAuthError("profile_unavailable", "Local user profile is unavailable.");
    }
    if (!user.enabled) {
      await this.sessions.revokeUser(this.installationId, userId);
      throw new LocalAuthError("profile_disabled", "Local user profile is disabled.");
    }
    return user;
  }

  private async issueSession(user: LocalUser) {
    return this.sessions.create(this.installationId, user.userId);
  }

  async login(emailInput: string, password: string): Promise<
    SuccessfulLocalAuthentication | InitialPasswordChallenge
  > {
    const email = normalizedEmail(emailInput);
    if (password.length < 1 || password.length > 4096) {
      throw new LocalAuthError("invalid_input", "Password is invalid.");
    }
    let identity;
    try {
      identity = await this.identityProvider.verifyPassword(email, password);
    } catch (error) {
      throw error;
    }
    const credentials: IdentityCredentials = identity;
    try {
      const user = await this.authorizedLocalUser(identity.userId, identity.email);
      if (await this.users.hasInitialPasswordMarker(user.userId)) {
        const challenge = await this.challenges.create({
          installationId: this.installationId,
          userId: user.userId,
          accessToken: identity.accessToken,
          refreshToken: identity.refreshToken,
        });
        return {
          kind: "password_change_required",
          challengeId: challenge.challengeId,
          expiresAt: challenge.record.expiresAt,
        };
      }
      const session = await this.issueSession(user);
      await this.identityProvider.signOut(credentials);
      return { kind: "authenticated", user, session };
    } catch (error) {
      await this.identityProvider.signOut(credentials);
      throw error;
    }
  }

  async changeInitialPassword(challengeId: string, newPasswordInput: string) {
    const newPassword = validatePassword(newPasswordInput);
    const result = await this.challenges.consume(
      challengeId,
      this.installationId,
      async (challenge) => {
        const user = await this.users.read(challenge.userId);
        if (!user || !user.enabled) {
          throw new LocalAuthError("profile_unavailable", "Local user profile is unavailable.");
        }
        await this.identityProvider.updatePassword(challenge, newPassword);
        await this.users.clearInitialPasswordMarker(user.userId);
        return {
          kind: "authenticated" as const,
          user,
          session: await this.issueSession(user),
        };
      },
    );
    if (!result) {
      throw new LocalAuthError("challenge_invalid", "Password-change challenge is invalid.");
    }
    return result;
  }

  async requestPasswordRecovery(emailInput: string, redirectTo: string) {
    const email = normalizedEmail(emailInput);
    await this.identityProvider.requestPasswordRecovery(email, redirectTo);
  }

  async completePasswordRecovery(
    proof: RecoveryProof,
    newPasswordInput: string,
  ): Promise<SuccessfulLocalAuthentication> {
    const newPassword = validatePassword(newPasswordInput);
    const identity = await this.identityProvider.verifyPasswordRecovery(proof);
    const credentials: IdentityCredentials = identity;
    try {
      const user = await this.authorizedLocalUser(identity.userId, identity.email);
      await this.identityProvider.updatePassword(credentials, newPassword);
      await this.users.clearInitialPasswordMarker(user.userId);
      return {
        kind: "authenticated",
        user,
        session: await this.issueSession(user),
      };
    } catch (error) {
      await this.identityProvider.signOut(credentials);
      throw error;
    }
  }
}
