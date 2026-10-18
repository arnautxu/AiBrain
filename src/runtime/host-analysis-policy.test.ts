import { describe, expect, it } from "vitest";
import { hostAnalysisConfig, hostAnalysisToolAllowed } from "./host-analysis-policy";
describe("host analysis server-only capability ceiling", () => {
  it("permits original attachment inspection and the exact business read allowlist only", () => {
    const policy = { webSearch: true, businessReads: true };
    expect(hostAnalysisToolAllowed(policy, "aibrain_documents", "inspect_attachment")).toBe(true);
    expect(hostAnalysisToolAllowed(policy, "officeexample_business", "attio_search")).toBe(true);
    expect(hostAnalysisToolAllowed(policy, "officeexample_business", "erp_read")).toBe(true);
    for (const [namespace, tool] of [["officeexample_business", "mail_read"], ["officeexample_business", "mail_search"], ["officeexample_business", "attio_action"], ["officeexample_business", "erp_action"], ["officeexample_business", "mail_draft"], ["aibrain_browser", "open"], ["aibrain_documents", "create"], ["aibrain_outlook", "search"], ["aibrain_gmail", "send"], ["aibrain_memory", "create"], ["aibrain_automations", "create"]]) expect(hostAnalysisToolAllowed(policy, namespace, tool)).toBe(false);
    expect(hostAnalysisToolAllowed({ ...policy, businessReads: false }, "officeexample_business", "attio_search")).toBe(false);
  });
  it("disables native commands, inherited apps/MCP and agents independently of prompts", () => {
    expect(hostAnalysisConfig({ webSearch: false, businessReads: false }, ["private_mcp", "gmail"])).toEqual({
      web_search: "disabled", "features.shell_tool": false, "features.apps": false,
      "features.browser_use": false, "features.multi_agent": false, apps: { _default: { enabled: false } },
      "mcp_servers.private_mcp.enabled": false, "mcp_servers.gmail.enabled": false,
    });
  });
});
