import "server-only";

import path from "node:path";
import { LocalAuthService } from "@/auth/auth-service";
import { FileLocalAuthChallengeStore } from "@/auth/local-auth-challenge-store";
import { FileLocalSessionStore } from "@/auth/local-session-store";
import { FileLocalUserStore } from "@/auth/local-user-store";
import { createSupabaseAuthIdentityProvider } from "@/auth/supabase-identity-provider";
import { loadInstallationConfig } from "@/config/installation";

export async function createLocalSessionContext() {
  const installation = await loadInstallationConfig();
  const users = new FileLocalUserStore(installation.paths.usersRoot);
  const sessions = new FileLocalSessionStore({
    rootDirectory: path.join(installation.paths.dataRoot, "sessions"),
  });
  const challenges = new FileLocalAuthChallengeStore({
    rootDirectory: path.join(installation.paths.dataRoot, "auth-challenges"),
  });
  return { installation, users, sessions, challenges };
}

export async function createLocalAuthService() {
  const { installation, users, sessions, challenges } = await createLocalSessionContext();
  return new LocalAuthService(
    installation.installationId,
    createSupabaseAuthIdentityProvider(),
    users,
    sessions,
    challenges,
  );
}
