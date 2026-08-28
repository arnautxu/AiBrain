import path from "node:path";
import type { InstallationConfig } from "@/config/installation-schema";
import type { ChatRequest } from "@/lib/chat-contract";
import {
  MarkdownPermissionProvider,
  PermissionResolutionError,
  type ResolvedPermissions,
} from "@/permissions";
import { FilePermissionResolutionAuditSink } from "@/runtime/permission-audit-sink";

export type ServerTurnPermissionIdentity = {
  installationId: string;
  userId: string;
  projectId: string;
  turnId: string;
};

export class TurnPermissionBindingError extends Error {
  constructor() {
    super("La política resolta no correspon al torn autenticat.");
    this.name = "TurnPermissionBindingError";
  }
}

export function assertCodexTurnPermissionBinding(
  chatRequest: ChatRequest,
  installationId: string,
  authenticatedUserId: string,
  permissions: ResolvedPermissions,
) {
  if (
    permissions.installationId !== installationId ||
    permissions.userId !== authenticatedUserId ||
    permissions.projectId !== chatRequest.projectId ||
    permissions.turnId !== chatRequest.assistantMessageId ||
    !/^[0-9a-f]{64}$/.test(permissions.fingerprint) ||
    !permissions.developerInstructions.includes(`Policy fingerprint: ${permissions.fingerprint}`)
  ) {
    throw new TurnPermissionBindingError();
  }
}

export function buildCodexDeveloperInstructions(
  chatRequest: ChatRequest,
  permissions: ResolvedPermissions,
  assistantName = "AiBrain",
) {
  const toneInstruction = {
    direct: "Sigues breu i prioritza la conclusió.",
    balanced: "Equilibra la conclusió amb el context necessari.",
    detailed: "Explica el raonament útil i els matisos de forma estructurada.",
  }[chatRequest.preferences.tone];
  const languageInstruction = {
    ca: "Respon en català, tret que l’usuari demani explícitament un altre idioma.",
    es: "Responde en castellano, salvo que el usuario pida explícitamente otro idioma.",
    en: "Respond in English unless the user explicitly requests another language.",
  }[chatRequest.preferences.language];
  const modeInstruction = {
    agent: "Completa la tasca i fes canvis verificables quan siguin necessaris.",
    plan: "No modifiquis fitxers. Investiga el context i lliura un pla executable amb riscos i verificació.",
    ask: "No modifiquis fitxers. Respon la pregunta amb evidència del workspace quan sigui útil.",
  }[chatRequest.options.mode];
  const imageInstruction = chatRequest.options.imageGeneration
    ? "Genera una imatge amb l’eina d’imatge del runtime i retorna-la com a resultat del torn."
    : "No generis imatges tret que l’usuari ho demani explícitament.";
  const webInstruction = chatRequest.options.webSearch
    ? `La cerca web en viu està disponible. Utilitza-la quan l'usuari demani buscar o verificar informació, quan els fets puguin haver canviat, quan calguin fonts o quan no estiguis segur d'una dada. Prioritza fonts primàries o autoritzades, inclou enllaços prop de les afirmacions que sustenten i no afirmis haver cercat si no has executat l'eina.`
    : "La cerca web està desactivada per a aquest torn. No afirmis que has consultat Internet.";
  const workbenchInstructions = `Ets ${assistantName}, l'assistent de treball privat d'aquesta empresa, construït sobre el runtime de Codex.
${languageInstruction}
${toneInstruction}
${modeInstruction}
${imageInstruction}
${webInstruction}
Treballa només dins del workspace configurat i utilitza les eines de Codex quan aportin evidència o siguin necessàries per completar la tasca.
No afirmis que una acció, una font o una integració funciona si no l'has observat.
Quan una acció necessiti aprovació, explica de forma concreta què vols fer i per què.`;
  return `${workbenchInstructions}\n\n${permissions.developerInstructions}`;
}

/**
 * Generic App Server command, file-change and permission escalation requests
 * are executable only when the immutable turn snapshot explicitly allows the
 * canonical tools.execute rule. Human approval cannot override a DENY.
 */
export function permissionAllowsGenericToolExecution(permissions: ResolvedPermissions) {
  const rule = permissions.rules.find((candidate) =>
    candidate.ruleId === "tools.execute" && candidate.action === "execute");
  return rule?.effect === "allow";
}

/**
 * Resolves and durably audits the effective policy for one authenticated turn.
 * Every identity field must come from the server-side session/thread context.
 */
export async function resolveServerTurnPermissions(
  installation: Readonly<InstallationConfig>,
  identity: Readonly<ServerTurnPermissionIdentity>,
): Promise<ResolvedPermissions> {
  if (identity.installationId !== installation.installationId) {
    throw new PermissionResolutionError(
      "PERMISSION_INSTALLATION_NOT_CONFIGURED",
      "Authenticated installation does not match this server configuration.",
    );
  }
  const auditSink = new FilePermissionResolutionAuditSink({
    installationId: installation.installationId,
    userId: identity.userId,
    usersRoot: installation.paths.usersRoot,
  });
  const provider = new MarkdownPermissionProvider({
    installations: [{
      installationId: installation.installationId,
      roots: {
        installationPolicyRoot: installation.paths.companyContextRoot,
        rolesRoot: path.join(installation.paths.dataRoot, "permission-scopes", "roles"),
        projectsRoot: path.join(installation.paths.dataRoot, "permission-scopes", "projects"),
        usersRoot: installation.paths.usersRoot,
      },
    }],
    auditSink,
  });
  return provider.resolveForUser(
    installation.installationId,
    identity.userId,
    {
      turnId: identity.turnId,
      // Roles are deliberately not an authentication or authorization concern in V1.
      roleId: null,
      projectId: identity.projectId,
    },
  );
}
