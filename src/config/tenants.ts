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
    name: "Northstar Operations",
    manifest: operationsBrainManifest,
  },
};

const demoAccounts: DemoAccount[] = [
  {
    id: "example-owner",
    name: "Alex Example",
    email: "alex@example.invalid",
    role: "owner",
    tenantId: "studio",
    tenantName: tenants.studio.name,
    productName: tenants.studio.manifest.identity.productName,
    description: "Propietari · pot editar el manifest i les finestres",
  },
  {
    id: "ops-member",
    name: "Equip Ops",
    email: "equip@operations.demo",
    role: "member",
    tenantId: "operations",
    tenantName: tenants.operations.name,
    productName: tenants.operations.manifest.identity.productName,
    description: "Membre · experiència operativa sense accés al control plane",
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
