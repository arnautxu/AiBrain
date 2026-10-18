export type HostAnalysisPolicy = { businessReads: boolean; webSearch: boolean; onViolation?: () => void };
const reads = new Set(["attio_search", "attio_notes", "attio_deals", "attio_tasks", "attio_members", "erp_read", "erp_accounting_summary"]);
export function hostAnalysisToolAllowed(policy: HostAnalysisPolicy, namespace: unknown, tool: unknown) {
  return namespace === "aibrain_documents" && tool === "inspect_attachment" ||
    policy.businessReads && namespace === "officeexample_business" && typeof tool === "string" && reads.has(tool);
}
export function hostAnalysisConfig(policy: HostAnalysisPolicy, mcpServers: string[]) {
  return {
    web_search: policy.webSearch ? "live" : "disabled",
    "features.shell_tool": false,
    "features.apps": false,
    "features.browser_use": false,
    "features.multi_agent": false,
    apps: { _default: { enabled: false } },
    ...Object.fromEntries(mcpServers.map(name => [`mcp_servers.${name}.enabled`, false])),
  };
}
