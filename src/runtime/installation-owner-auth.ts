type OwnerAccess = { accessToken: string; chatgptAccountId: string; chatgptPlanType?: string };

/** Owner socket authentication is not supported. */
export function installationOwnerAuthSocket(installationId: string, environment: Record<string, string | undefined> = process.env): string | null {
  void installationId;
  if (environment.AIBRAIN_CODEX_OWNER_AUTH_SOCKET?.trim()) {
    throw new Error("Installation owner authentication is not authorized.");
  }
  return null;
}

export function readInstallationOwnerAccess(installationId: string, previousAccountId?: string): Promise<OwnerAccess> {
  void previousAccountId;
  installationOwnerAuthSocket(installationId);
  throw new Error("Installation owner authentication is unavailable.");
}
