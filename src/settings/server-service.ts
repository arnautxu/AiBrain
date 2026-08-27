import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AuthSession } from "@/auth/types";
import { loadInstallationConfig } from "@/config/installation";
import { MarkdownPermissionProvider } from "@/permissions";
import type { PermissionAction } from "@/permissions/types";
import { readRuntimeConfig } from "@/runtime/config";
import { FilePermissionResolutionAuditSink } from "@/runtime/permission-audit-sink";
import {
  CONTROLLABLE_APP_IDS,
  type AppCatalogueItem,
  type ControllableAppId,
  type PermissionSummary,
  type SettingsPatch,
  type SettingsSnapshot,
} from "@/settings/contracts";
import { FileSettingsStore } from "@/settings/preferences-store";

const ACTIONS: PermissionAction[] = ["consult", "respond", "execute", "publish"];

function isSettingsAdmin(userId: string) {
  return (process.env.AIBRAIN_USAGE_ADMIN_USER_IDS ?? "").split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(userId);
}

async function context(session: AuthSession) {
  const installation = await loadInstallationConfig();
  if (installation.installationId !== session.tenant.id) {
    throw new Error("Authenticated installation does not match settings storage.");
  }
  return {
    installation,
    store: new FileSettingsStore(installation.paths.dataRoot, installation.paths.usersRoot),
    isAdmin: isSettingsAdmin(session.user.id),
  };
}

async function permissionsForSession(session: AuthSession): Promise<PermissionSummary[]> {
  const installation = await loadInstallationConfig();
  try {
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
      auditSink: new FilePermissionResolutionAuditSink({
        installationId: installation.installationId,
        userId: session.user.id,
        usersRoot: installation.paths.usersRoot,
      }),
    });
    const resolved = await provider.resolveForUser(
      installation.installationId,
      session.user.id,
      { turnId: randomUUID(), roleId: null, projectId: null },
    );
    return ACTIONS.map((action) => {
      const rules = resolved.rules.filter((rule) => rule.action === action).map((rule) => ({
        ruleId: rule.ruleId,
        effect: rule.effect,
        instruction: rule.instruction,
      }));
      return {
        action,
        effect: rules.some((rule) => rule.effect === "deny")
          ? "deny" as const
          : rules.some((rule) => rule.effect === "allow") ? "allow" as const : "not_defined" as const,
        rules,
      };
    });
  } catch {
    return ACTIONS.map((action) => ({ action, effect: "not_defined", rules: [] }));
  }
}

function controlledApp(
  id: ControllableAppId,
  definition: Omit<AppCatalogueItem,
    "id" | "status" | "statusDetail" | "installationEnabled" | "userEnabled" |
    "effectiveEnabled" | "canUserChange" | "canAdminChange">,
  installationEnabled: boolean,
  userEnabled: boolean,
  configured: boolean,
  isAdmin: boolean,
): AppCatalogueItem {
  const effectiveEnabled = configured && installationEnabled && userEnabled;
  return {
    id,
    ...definition,
    status: !configured ? "not_configured" : !installationEnabled ? "blocked" :
      effectiveEnabled ? "available" : "available",
    statusDetail: !configured
      ? "El runtime no ha publicado esta capacidad."
      : !installationEnabled
        ? "Bloqueada por la empresa."
        : !userEnabled ? "Desactivada para tu cuenta." : "Disponible para usar.",
    installationEnabled,
    userEnabled,
    effectiveEnabled,
    canUserChange: configured && installationEnabled,
    canAdminChange: isAdmin,
  };
}

async function appCatalogue(session: AuthSession, isAdmin: boolean) {
  const { installation, store } = await context(session);
  const [user, company] = await Promise.all([store.readUser(session.user.id), store.readInstallation()]);
  const runtime = readRuntimeConfig(installation.installationId);
  const runtimeConfigured = runtime.mode === "codex";
  const switches = Object.fromEntries(CONTROLLABLE_APP_IDS.map((id) => [id, {
    installation: company.apps[id],
    user: user.apps[id],
  }])) as Record<ControllableAppId, { installation: boolean; user: boolean }>;

  const controlled = <Id extends ControllableAppId>(
    id: Id,
    definition: Parameters<typeof controlledApp>[1],
    configured = runtimeConfigured,
  ) => controlledApp(
    id,
    definition,
    switches[id].installation,
    switches[id].user,
    configured,
    isAdmin,
  );

  return [
    {
      id: "codex-runtime",
      label: "Asistente de trabajo",
      description: "Motor privado que responde, trabaja con archivos y ejecuta tareas dentro del workspace.",
      kind: "runtime",
      status: runtimeConfigured ? "available" : "not_configured",
      statusDetail: runtimeConfigured ? "Runtime configurado en el servidor." : "CHAT_RUNTIME=codex no está configurado.",
      scopes: ["Workspace aislado del empleado", "Conversaciones de la empresa"],
      permissionActions: ["consult", "respond", "execute"],
      approvalRequired: true,
      installationEnabled: runtimeConfigured,
      userEnabled: runtimeConfigured,
      effectiveEnabled: runtimeConfigured,
      canUserChange: false,
      canAdminChange: false,
      configurationHint: runtimeConfigured ? null : "Configura el runtime Codex en el servidor.",
    },
    controlled("web-search", {
      label: "Búsqueda web",
      description: "Consulta información pública y devuelve fuentes durante una conversación.",
      kind: "capability",
      scopes: ["Internet público HTTP/HTTPS", "Sin acceso a red privada"],
      permissionActions: ["consult"],
      approvalRequired: false,
      configurationHint: runtimeConfigured ? null : "Conecta un runtime que publique búsqueda web.",
    }),
    controlled("image-generation", {
      label: "Generación de imágenes",
      description: "Crea imágenes cuando el runtime conectado publica esa capacidad.",
      kind: "capability",
      scopes: ["Prompt del turno", "Artefactos privados del proyecto"],
      permissionActions: ["respond", "execute"],
      approvalRequired: false,
      configurationHint: runtimeConfigured ? null : "Conecta un runtime compatible con imágenes.",
    }),
    controlled("skills", {
      label: "Skills instaladas",
      description: "Procedimientos revisados por la empresa que amplían la forma de trabajar del asistente.",
      kind: "plugin",
      scopes: ["Solo skills publicadas por este servidor"],
      permissionActions: ["consult", "respond", "execute"],
      approvalRequired: true,
      configurationHint: runtimeConfigured ? null : "Instala las skills en el runtime del empleado.",
    }),
    controlled("managed-browser", {
      label: "Navegador de trabajo",
      description: "Perfil Chrome privado por empleado, con control humano y aprobaciones para acciones sensibles.",
      kind: "connector",
      scopes: ["Perfil privado del empleado", "Internet público HTTP/HTTPS", "Descargas privadas por conversación"],
      permissionActions: ["consult", "execute"],
      approvalRequired: true,
      configurationHint: runtimeConfigured ? null : "Configura Chrome for Testing y el gateway privado.",
    }),
    {
      id: "documents",
      label: "Archivos y documentos",
      description: "Adjunta, previsualiza y publica documentos mediante el flujo de confirmación seguro.",
      kind: "capability",
      status: "connected",
      statusDetail: "Incluida y controlada por PERMISSIONS.md.",
      scopes: ["Orígenes de lectura permitidos", "Destino de publicación de la empresa"],
      permissionActions: ["consult", "publish"],
      approvalRequired: true,
      installationEnabled: true,
      userEnabled: true,
      effectiveEnabled: true,
      canUserChange: false,
      canAdminChange: false,
      configurationHint: null,
    },
  ] satisfies AppCatalogueItem[];
}

export async function featurePolicyForUser(session: AuthSession) {
  const { store } = await context(session);
  const [user, installation] = await Promise.all([
    store.readUser(session.user.id),
    store.readInstallation(),
  ]);
  return Object.fromEntries(CONTROLLABLE_APP_IDS.map((id) => [
    id,
    user.apps[id] && installation.apps[id],
  ])) as Record<ControllableAppId, boolean>;
}

export async function featurePolicyForIdentity(installationId: string, userId: string) {
  const installation = await loadInstallationConfig();
  if (installation.installationId !== installationId) {
    throw new Error("Authenticated installation does not match feature policy storage.");
  }
  const store = new FileSettingsStore(installation.paths.dataRoot, installation.paths.usersRoot);
  const [user, company] = await Promise.all([store.readUser(userId), store.readInstallation()]);
  return Object.fromEntries(CONTROLLABLE_APP_IDS.map((id) => [
    id,
    user.apps[id] && company.apps[id],
  ])) as Record<ControllableAppId, boolean>;
}

export async function settingsSnapshot(session: AuthSession): Promise<SettingsSnapshot> {
  const { installation, store, isAdmin } = await context(session);
  const [userSettings, permissions, apps] = await Promise.all([
    store.readUser(session.user.id),
    permissionsForSession(session),
    appCatalogue(session, isAdmin),
  ]);
  return {
    schemaVersion: 1,
    account: {
      userId: session.user.id,
      displayName: session.user.name,
      email: session.user.email,
      provider: session.provider,
      expiresAt: session.expiresAt,
    },
    company: {
      installationId: installation.installationId,
      name: installation.companyName,
      isAdmin,
    },
    apps,
    notifications: userSettings.notifications,
    permissions,
    privacy: {
      conversationStorage: "company_private",
      providerTraining: "not_managed_here",
      employeeIsolation: true,
      memoryScope: "explicit_user_memory",
    },
    browser: {
      profileScope: "private_per_employee",
      networkPolicy: "public_http_https_only",
      privateNetworkAllowed: false,
      mutationsRequireApproval: true,
      downloadsArePrivate: true,
    },
  };
}

export async function updateSettings(session: AuthSession, patch: SettingsPatch) {
  const { store, isAdmin } = await context(session);
  if (patch.target === "installation-app") {
    if (!isAdmin) {
      const error = new Error("Settings administrator permission is required.") as Error & { code: string };
      error.code = "SETTINGS_ADMIN_REQUIRED";
      throw error;
    }
    await store.updateInstallation((current) => ({
      ...current,
      apps: { ...current.apps, [patch.appId]: patch.enabled },
    }));
  } else if (patch.target === "user-app") {
    await store.updateUser(session.user.id, (current) => ({
      ...current,
      apps: { ...current.apps, [patch.appId]: patch.enabled },
    }));
  } else {
    await store.updateUser(session.user.id, (current) => ({
      ...current,
      notifications: { ...current.notifications, ...patch.values },
    }));
  }
  return settingsSnapshot(session);
}
