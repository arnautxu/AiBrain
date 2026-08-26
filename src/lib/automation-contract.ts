export type AutomationDefinition = {
  id: "workspace-inventory" | "runtime-diagnostics";
  name: string;
  description: string;
  category: "workspace" | "runtime";
  mutates: false;
};

export type AutomationRun = {
  id: string;
  automationId: AutomationDefinition["id"];
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  output: string;
};

export type AutomationMember = {
  id: string;
  label: string;
  email: string | null;
};

export type AutomationControlSnapshot = {
  automations: Array<AutomationDefinition & { enabled: boolean }>;
  members: AutomationMember[];
  permissions: Array<{
    userId: string;
    automationId: AutomationDefinition["id"];
    enabled: boolean;
  }>;
};

export function isAutomationId(value: unknown): value is AutomationDefinition["id"] {
  return value === "workspace-inventory" || value === "runtime-diagnostics";
}
