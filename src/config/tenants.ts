import "server-only";

import type { DemoAccount } from "@/auth/types";
import {
  baseBrainManifest,
  operationsBrainManifest,
  type BrainManifest,
} from "@/config/brain";

export type TenantDefinition = {
  id: string;
  name: string;
  manifest: BrainManifest;
};

const tenants: Record<string, TenantDefinition> = {
  studio: {
    id: "studio",
    name: "Example Laboratory",
    manifest: baseBrainManifest,
  },
  operations: {
    id: "operations",
    name: "Northwind Advisory QA",
    manifest: operationsBrainManifest,
  },
};

const demoAccounts: DemoAccount[] = [
  {
    id: "arnau-owner",
    name: "Alex",
    email: "alex@example-laboratory.test",
    role: "owner",
    tenantId: "studio",
    tenantName: tenants.studio.name,
    productName: tenants.studio.manifest.identity.productName,
    description: "Cuenta de desarrollo con proyectos sintéticos",
  },
  {
    id: "ops-member",
    name: "Taylor",
    email: "taylor@northwind-advisory.test",
    role: "member",
    tenantId: "operations",
    tenantName: tenants.operations.name,
    productName: tenants.operations.manifest.identity.productName,
    description: "Cuenta QA con actividad sintética",
  },
];

export function getTenantDefinition(tenantId: string) {
  return tenants[tenantId] ?? null;
}

export function getSeedManifest(tenantId: string) {
  return getTenantDefinition(tenantId)?.manifest ?? null;
}

export function listDemoAccounts() {
  return demoAccounts.map((account) => ({ ...account }));
}

export function getDemoAccount(userId: string) {
  return demoAccounts.find((account) => account.id === userId) ?? null;
}
