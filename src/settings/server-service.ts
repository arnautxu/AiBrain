import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AuthSession } from "@/auth/types";
import { isWorkspaceAdmin } from "@/admin/server-service";
import { workspacePolicyForIdentity } from "@/admin/policy-service";
import { loadInstallationConfig } from "@/config/installation";
import { codexManagedAppCapabilities } from "@/connectors/server-service";
import { MarkdownPermissionProvider } from "@/permissions";
import type { PermissionAction } from "@/permissions/types";
import { readRuntimeConfig } from "@/runtime/config";
import { probeChromeRuntimeCapability } from "@/runtime/browser/chrome-runtime";
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
import { gmailCapabilityForSession } from "@/connectors/gmail-server-service";
import { GMAIL_CONNECTOR_ID, GMAIL_MINIMUM_SCOPES } from "@/connectors/gmail-contracts";
import { outlookCapabilityForSession } from "@/connectors/outlook-server-service";
import { OUTLOOK_API_SCOPES, OUTLOOK_CONNECTOR_ID } from "@/connectors/outlook-contracts";
import { catalogRuntimeEnforcer } from "@/catalog/access-service";
import { projectPersonalConnectorSettings, type PersonalConnectorSettings } from "@/settings/connector-settings";

const ACTIONS: PermissionAction[] = ["consult", "respond", "execute", "publish"];

async function context(session: AuthSession) {
  const installation = await loadInstallationConfig();
  if (installation.installationId !== session.tenant.id) {
    throw new Error("Authenticated installation does not match settings storage.");
  }
  return {
    installation,
    store: new FileSettingsStore(installation.paths.dataRoot, installation.paths.usersRoot),
    isAdmin: await isWorkspaceAdmin(session),
  };
}

async function permissionsForSession(session: AuthSession): Promise<PermissionSummary[]> {
  const installation = await loadInstallationConfig();
  try {
    const workspacePolicy = await workspacePolicyForIdentity(installation.installationId, session.user.id);
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
      { turnId: randomUUID(), roleId: workspacePolicy.roleId, projectId: null },
    );
    return ACTIONS.map((action) => {
      const rules = resolved.rules.filter((rule) => rule.action === action).map((rule) => ({
        ruleId: rule.ruleId,
        effect: rule.effect,
        instruction: rule.instruction,
      }));
      if (!workspacePolicy.policy.capabilities[action]) {
        rules.push({
          ruleId: "workspace.group-policy",
          effect: "deny",
          instruction: "Bloqueado por la política efectiva del rol o de un grupo del workspace.",
        });
      }
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
  const [user, company, workspacePolicy, chromeCapability] = await Promise.all([
    store.readUser(session.user.id),
    store.readInstallation(),
    workspacePolicyForIdentity(session.tenant.id, session.user.id),
    probeChromeRuntimeCapability({
      executablePath: process.env.AIBRAIN_CHROME_BIN?.trim() || undefined,
      expectedVersion: process.env.AIBRAIN_CHROME_EXPECTED_VERSION?.trim() || undefined,
    }),
  ]);
  const runtime = readRuntimeConfig(installation.installationId);
  const runtimeConfigured = runtime.mode === "codex";
  const browserGatewayConfigured = process.env.NODE_ENV !== "production" ||
    Boolean(process.env.AIBRAIN_BROWSER_GATEWAY_SECRET?.trim());
  const browserConfigured = runtimeConfigured && chromeCapability.available && browserGatewayConfigured;
  const switches = Object.fromEntries(CONTROLLABLE_APP_IDS.map((id) => [id, {
    installation: company.apps[id] && workspacePolicy.policy.apps[id],
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

  const builtInApps = [
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
      configurationHint: browserConfigured ? null : "Configura Chrome for Testing y el gateway privado.",
    }, browserConfigured),
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

  // A connector has no settings placeholder: it appears only after a personal
  // binding is present and the server-only provider has verified it callable.
  // The read-only API retains explicit failure codes for an operator without
  // advertising a non-working application in the employee UI.
  const connectedApps = await codexManagedAppCapabilities(session)
    .then((capabilities) => capabilities.filter((capability) => capability.status === "connected"))
    .catch(() => []);
  return [
    ...builtInApps,
    ...connectedApps.map((capability) => ({
      id: capability.connectorId,
      label: capability.label,
      description: "Disponibilidad de una aplicación MCP ya autenticada por Codex.",
      kind: "connector" as const,
      status: "connected" as const,
      statusDetail: "Conectada y disponible para la operación de lectura publicada.",
      scopes: ["Disponibilidad de la aplicación instalada"],
      permissionActions: ["consult" as const],
      approvalRequired: false,
      installationEnabled: true,
      userEnabled: true,
      effectiveEnabled: true,
      canUserChange: false,
      canAdminChange: false,
      configurationHint: null,
    })),
  ] satisfies AppCatalogueItem[];
}

export async function featurePolicyForUser(session: AuthSession) {
  if (session.provider === "demo") {
    return Object.fromEntries(CONTROLLABLE_APP_IDS.map((id) => [id, true])) as Record<ControllableAppId, boolean>;
  }
  const { store } = await context(session);
  const [user, installation, workspacePolicy] = await Promise.all([
    store.readUser(session.user.id),
    store.readInstallation(),
    workspacePolicyForIdentity(session.tenant.id, session.user.id),
  ]);
  return Object.fromEntries(CONTROLLABLE_APP_IDS.map((id) => [
    id,
    user.apps[id] && installation.apps[id] && workspacePolicy.policy.apps[id],
  ])) as Record<ControllableAppId, boolean>;
}

export async function featurePolicyForIdentity(installationId: string, userId: string) {
  const installation = await loadInstallationConfig();
  if (installation.installationId !== installationId) {
    throw new Error("Authenticated installation does not match feature policy storage.");
  }
  const store = new FileSettingsStore(installation.paths.dataRoot, installation.paths.usersRoot);
  const [user, company, workspacePolicy] = await Promise.all([
    store.readUser(userId),
    store.readInstallation(),
    workspacePolicyForIdentity(installationId, userId),
  ]);
  return Object.fromEntries(CONTROLLABLE_APP_IDS.map((id) => [
    id,
    user.apps[id] && company.apps[id] && workspacePolicy.policy.apps[id],
  ])) as Record<ControllableAppId, boolean>;
}

export async function settingsSnapshot(session: AuthSession): Promise<SettingsSnapshot> {
  const { installation, store, isAdmin } = await context(session);
  const catalog = await catalogRuntimeEnforcer(installation.installationId, session.user.id);
  const gmailAuthorized = catalog.allowsConnector(GMAIL_CONNECTOR_ID);
  const outlookAuthorized = catalog.allowsConnector(OUTLOOK_CONNECTOR_ID);
  const [userSettings, permissions, apps, gmail, outlook] = await Promise.all([
    store.readUser(session.user.id),
    permissionsForSession(session),
    appCatalogue(session, isAdmin),
    gmailAuthorized ? gmailCapabilityForSession(session).catch(() => null) : Promise.resolve(null),
    outlookAuthorized ? outlookCapabilityForSession(session).catch(() => null) : Promise.resolve(null),
  ]);
  const connectors: PersonalConnectorSettings[] = [];
  if (gmailAuthorized) {
    connectors.push(projectPersonalConnectorSettings(
      gmail ?? {
        connectorId: GMAIL_CONNECTOR_ID,
        label: "Gmail",
        status: "degraded",
        statusCode: "GMAIL_CAPABILITY_CHECK_FAILED",
        checkedAt: null,
        effectiveOperations: [],
        approvalRequiredOperations: [],
        connectUrl: null,
        disconnectUrl: null,
        accountEmail: null,
        connectionVersion: null,
      },
      GMAIL_MINIMUM_SCOPES,
      {
        connected: "Cuenta personal verificada mediante lectura de perfil.",
        requiresLogin: "Disponible para conectar con tu cuenta personal de Gmail.",
        adminSetupRequired: "Disponible para conectar cuando el administrador complete Google Cloud OAuth.",
        unavailable: "Gmail está autorizado, pero no se puede comprobar ahora mismo.",
      },
    ));
  }
  if (outlookAuthorized) {
    connectors.push(projectPersonalConnectorSettings(
      outlook ?? {
        connectorId: OUTLOOK_CONNECTOR_ID,
        label: "Outlook",
        status: "degraded",
        statusCode: "OUTLOOK_CAPABILITY_CHECK_FAILED",
        checkedAt: null,
        effectiveOperations: [],
        approvalRequiredOperations: [],
        connectUrl: null,
        disconnectUrl: null,
        accountEmail: null,
        connectionVersion: null,
      },
      OUTLOOK_API_SCOPES,
      {
        connected: "Cuenta personal verificada mediante Microsoft Graph.",
        requiresLogin: "Disponible para conectar con tu cuenta personal de Outlook.",
        adminSetupRequired: "Disponible para conectar cuando el administrador complete Microsoft Entra OAuth.",
        unavailable: "Outlook está autorizado, pero no se puede comprobar ahora mismo.",
      },
    ));
  }
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
    connectors,
    memory: {
      enabled: true,
      confirmationRequired: false,
      scopes: ["private", "project", "company"],
      provenanceVisible: true,
      employeeRuntimeIsolated: true,
      sharedComputerHistory: false,
    },
    notifications: userSettings.notifications,
    permissions,
    privacy: {
      conversationStorage: "company_private",
      providerTraining: "not_managed_here",
      employeeIsolation: true,
      memoryScope: "automatic_private_memory",
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
  } else {
    await store.updateUser(session.user.id, (current) => ({
      ...current,
      notifications: { ...current.notifications, ...patch.values },
    }));
  }
  return settingsSnapshot(session);
}
