export const CONTROLLABLE_APP_IDS = [
  "web-search",
  "image-generation",
  "skills",
  "managed-browser",
] as const;

export type ControllableAppId = typeof CONTROLLABLE_APP_IDS[number];
export type AppKind = "runtime" | "capability" | "plugin" | "connector";
export type AppStatus = "connected" | "available" | "blocked" | "not_configured";

export type AppCatalogueItem = {
  id: string;
  label: string;
  description: string;
  kind: AppKind;
  status: AppStatus;
  statusDetail: string;
  scopes: string[];
  permissionActions: Array<"consult" | "respond" | "execute" | "publish">;
  approvalRequired: boolean;
  installationEnabled: boolean;
  userEnabled: boolean;
  effectiveEnabled: boolean;
  canUserChange: boolean;
  canAdminChange: boolean;
  configurationHint: string | null;
};

export type NotificationSettings = {
  backgroundTurns: boolean;
  approvals: boolean;
  failures: boolean;
  sound: boolean;
};

export type PermissionSummary = {
  action: "consult" | "respond" | "execute" | "publish";
  effect: "allow" | "deny" | "not_defined";
  rules: Array<{ ruleId: string; effect: "allow" | "deny"; instruction: string }>;
};

export type SettingsSnapshot = {
  schemaVersion: 1;
  account: {
    userId: string;
    displayName: string;
    email: string;
    provider: "demo" | "local";
    expiresAt: string;
  };
  company: {
    installationId: string;
    name: string;
    isAdmin: boolean;
  };
  apps: AppCatalogueItem[];
  notifications: NotificationSettings;
  permissions: PermissionSummary[];
  privacy: {
    conversationStorage: "company_private";
    providerTraining: "not_managed_here";
    employeeIsolation: true;
    memoryScope: "explicit_user_memory";
  };
  browser: {
    profileScope: "private_per_employee";
    networkPolicy: "public_http_https_only";
    privateNetworkAllowed: false;
    mutationsRequireApproval: true;
    downloadsArePrivate: true;
  };
};

export type SettingsPatch =
  | { target: "user-app"; appId: ControllableAppId; enabled: boolean }
  | { target: "installation-app"; appId: ControllableAppId; enabled: boolean }
  | { target: "notifications"; values: Partial<NotificationSettings> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isControllableAppId(value: unknown): value is ControllableAppId {
  return typeof value === "string" && CONTROLLABLE_APP_IDS.includes(value as ControllableAppId);
}

export function isSettingsPatch(value: unknown): value is SettingsPatch {
  if (!isRecord(value) || typeof value.target !== "string") return false;
  if (value.target === "user-app" || value.target === "installation-app") {
    return Object.keys(value).length === 3 &&
      isControllableAppId(value.appId) && typeof value.enabled === "boolean";
  }
  if (value.target !== "notifications" || !isRecord(value.values) ||
      Object.keys(value).length !== 2) return false;
  const values = value.values;
  const keys = Object.keys(values);
  return keys.length > 0 && keys.every((key) =>
    ["backgroundTurns", "approvals", "failures", "sound"].includes(key) &&
    typeof values[key] === "boolean");
}

export function isSettingsSnapshot(value: unknown): value is SettingsSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.account) ||
      !isRecord(value.company) || !Array.isArray(value.apps) ||
      !isRecord(value.notifications) || !Array.isArray(value.permissions) ||
      !isRecord(value.privacy) || !isRecord(value.browser)) return false;
  const notifications = value.notifications;
  return typeof value.account.userId === "string" &&
    typeof value.account.displayName === "string" &&
    typeof value.account.email === "string" &&
    typeof value.company.installationId === "string" &&
    typeof value.company.name === "string" &&
    typeof value.company.isAdmin === "boolean" &&
    value.apps.every((item) => isRecord(item) && typeof item.id === "string" &&
      typeof item.label === "string" && typeof item.effectiveEnabled === "boolean") &&
    ["backgroundTurns", "approvals", "failures", "sound"].every((key) =>
      typeof notifications[key] === "boolean");
}
