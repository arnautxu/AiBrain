import type { WorkspaceRoleId } from "@/admin/contracts";

export const CATALOG_SCHEMA_VERSION = 1 as const;
export const CATALOG_ID = /^[a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*$/;
export const CATALOG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROVIDER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type CatalogResourceKind = "skill" | "app" | "connector" | "mcp";
export type CatalogCredentialMode = "none" | "personal-oauth" | "shared-resource";
export type CatalogRuleScope = "installation" | "role" | "group" | "user";
export type CatalogRuleEffect = "allow" | "deny";
export type CatalogOperation = "read" | "write";

export type CatalogResource = {
  id: string;
  kind: CatalogResourceKind;
  label: string;
  credentialMode: CatalogCredentialMode;
  managedBy: "graphikai" | "company";
  /** A shared credential may only ever represent a company-owned resource. */
  sharedResource: boolean;
  appId: string | null;
  connectorId: string | null;
  mcp: { server: string; readTools: string[]; sensitiveWriteTools: string[] } | null;
};

export type CatalogRule = {
  id: string;
  scope: CatalogRuleScope;
  subjectId: string | null;
  resourceId: string;
  effect: CatalogRuleEffect;
  operations: CatalogOperation[];
};

export type CatalogState = {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  installationId: string;
  revision: number;
  resources: CatalogResource[];
  rules: CatalogRule[];
};

export type CatalogAuditEvent = {
  schemaVersion: 1;
  installationId: string;
  actorUserId: string;
  action: "catalog.resource-upserted" | "catalog.rule-set";
  targetId: string;
  summary: string;
  occurredAt: string;
};

export type CatalogPrincipal = {
  installationId: string;
  userId: string;
  roleId: WorkspaceRoleId;
  groupIds: string[];
  workspaceCanExecute: boolean;
};

export type CatalogCommand =
  | { action: "upsert-resource"; resource: CatalogResource }
  | { action: "set-rule"; rule: CatalogRule };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function id(value: unknown) {
  return typeof value === "string" && CATALOG_ID.test(value);
}

function stringArray(value: unknown, validate: (item: unknown) => boolean) {
  return Array.isArray(value) && value.every(validate) && new Set(value).size === value.length;
}

export function isCatalogResource(value: unknown): value is CatalogResource {
  if (!record(value) || Object.keys(value).length !== 9 || !id(value.id) ||
      !["skill", "app", "connector", "mcp"].includes(String(value.kind)) ||
      typeof value.label !== "string" || value.label.trim().length === 0 || value.label.length > 120 ||
      !["none", "personal-oauth", "shared-resource"].includes(String(value.credentialMode)) ||
      !["graphikai", "company"].includes(String(value.managedBy)) || typeof value.sharedResource !== "boolean" ||
      !(typeof value.appId === "string" && id(value.appId) || value.appId === null) ||
      !(typeof value.connectorId === "string" && id(value.connectorId) || value.connectorId === null) ||
      !(value.mcp === null || record(value.mcp))) return false;
  if (value.credentialMode === "shared-resource" && (!value.sharedResource || value.managedBy !== "company")) return false;
  if (value.credentialMode === "personal-oauth" && value.sharedResource) return false;
  if (value.kind === "skill") return value.appId === null && value.connectorId === null && value.mcp === null && value.credentialMode === "none";
  if (value.kind === "app") return value.appId !== null && value.connectorId === null && value.mcp === null;
  if (value.kind === "connector") return value.appId === null && value.connectorId !== null && value.mcp === null;
  const mcp = value.mcp;
  if (value.appId !== null || value.connectorId !== null || !record(mcp) || Object.keys(mcp).length !== 3) return false;
  const { server, readTools, sensitiveWriteTools } = mcp;
  if (typeof server !== "string" || !PROVIDER_IDENTIFIER.test(server) ||
      !stringArray(readTools, (tool) => typeof tool === "string" && PROVIDER_IDENTIFIER.test(tool)) ||
      !stringArray(sensitiveWriteTools, (tool) => typeof tool === "string" && PROVIDER_IDENTIFIER.test(tool))) return false;
  const reads = readTools as string[];
  const writes = sensitiveWriteTools as string[];
  return reads.length + writes.length > 0 && !reads.some((tool) => writes.includes(tool));
}

export function isCatalogRule(value: unknown): value is CatalogRule {
  const operations = record(value) ? value.operations : undefined;
  if (!record(value) || Object.keys(value).length !== 6 || !id(value.id) || !id(value.resourceId) ||
      !["installation", "role", "group", "user"].includes(String(value.scope)) ||
      !["allow", "deny"].includes(String(value.effect)) ||
      !Array.isArray(operations) || !stringArray(operations, (item) => item === "read" || item === "write") || operations.length === 0) return false;
  if (value.scope === "installation") return value.subjectId === null;
  if (value.scope === "role") return typeof value.subjectId === "string" && ["workspace-owner", "workspace-admin", "workspace-member"].includes(value.subjectId);
  return typeof value.subjectId === "string" && CATALOG_UUID.test(value.subjectId);
}

export function isCatalogCommand(value: unknown): value is CatalogCommand {
  return record(value) && (value.action === "upsert-resource" && Object.keys(value).length === 2 && isCatalogResource(value.resource) ||
    value.action === "set-rule" && Object.keys(value).length === 2 && isCatalogRule(value.rule));
}
