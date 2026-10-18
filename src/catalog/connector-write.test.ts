import { it, expect } from "vitest";
import { CatalogRuntimeEnforcer } from "./runtime-enforcement";
import type { CatalogState, CatalogPrincipal } from "./contracts";
const principal: CatalogPrincipal = { installationId: "retaildemo", userId: "11111111-1111-4111-8111-111111111111", roleId: "workspace-member", groupIds: [], workspaceCanExecute: true };
const state: CatalogState = { schemaVersion: 1, installationId: "retaildemo", revision: 1, resources: [{ id: "retaildemo-shopify-themes", kind: "connector", label: "Website", credentialMode: "shared-resource", managedBy: "company", sharedResource: true, appId: null, connectorId: "retaildemo-shopify-themes", mcp: null }], rules: [{ id: "website-read", scope: "user", subjectId: principal.userId, resourceId: "retaildemo-shopify-themes", effect: "allow", operations: ["read"] }] };
it("does not turn a visible connector or generic execution permission into a website write grant", () => {
  expect(new CatalogRuntimeEnforcer(state, principal).allowsConnector("retaildemo-shopify-themes")).toBe(true);
  expect(new CatalogRuntimeEnforcer(state, principal).allowsConnectorWrite("retaildemo-shopify-themes")).toBe(false);
  const write = { ...state, rules: [{ ...state.rules[0], operations: ["read", "write"] as ("read" | "write")[] }] };
  expect(new CatalogRuntimeEnforcer(write, principal).allowsConnectorWrite("retaildemo-shopify-themes")).toBe(true);
  expect(new CatalogRuntimeEnforcer(write, { ...principal, workspaceCanExecute: false }).allowsConnectorWrite("retaildemo-shopify-themes")).toBe(false);
  expect(new CatalogRuntimeEnforcer(write, { ...principal, installationId: "foreign" }).allowsConnectorWrite("retaildemo-shopify-themes")).toBe(false);
});
