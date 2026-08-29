import { describe, expect, it } from "vitest";
import type { CatalogResource } from "@/catalog/contracts";
import { connectorMentionDeveloperInstructions, projectConnectorMention } from "@/connectors/mentions-contract";

const gmail: CatalogResource = {
  id: "gmail", kind: "connector", label: "Gmail", credentialMode: "personal-oauth", managedBy: "company",
  sharedResource: false, appId: null, connectorId: "gmail", mcp: null,
};

describe("connector mentions", () => {
  it("projects OAuth state without exposing credentials and labels unavailable providers honestly", () => {
    expect(projectConnectorMention(gmail, new Map())).toMatchObject({ id: "gmail", status: "requires_login", canRead: false });
    expect(projectConnectorMention(gmail, new Map([["gmail", { status: "connected", statusCode: null }]]))).toMatchObject({ status: "connected", canRead: true });
    expect(projectConnectorMention(gmail, new Map([["gmail", { status: "revoked", statusCode: "CONNECTOR_BINDING_REVOKED" }]]))).toMatchObject({ status: "unavailable", canRead: false });
  });

  it("creates a server-owned turn scope rather than relying on the visible @ label", () => {
    const instructions = connectorMentionDeveloperInstructions([{ resource: gmail, mention: projectConnectorMention(gmail, new Map()) }]);
    expect(instructions).toContain('"id":"gmail"');
    expect(instructions).toContain("solamente estas fuentes conectadas");
    expect(instructions).not.toContain("credentialRef");
  });
});
