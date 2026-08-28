import { connectorFingerprint } from "@/connectors/canonical";
import { assertAuthorizationFresh, prepareConnectorAuthorization } from "@/connectors/authorization";
import { FileConnectorBindingStore } from "@/connectors/binding-store";
import { FileConnectorAuthorizationStore } from "@/connectors/authorization-store";
import {
  CODEX_MANAGED_APP_CONNECTOR_ID,
  CodexManagedAppProvider,
  codexManagedAppDefinition,
  codexManagedAppIdForBinding,
  type CodexInstalledAppTransport,
} from "@/connectors/codex-managed-app-provider";
import { ConnectorError, type ConnectorAuthorizationSnapshot, type ConnectorPrincipal } from "@/connectors/contracts";
import type { CodexManagedAppActionConfig } from "@/config/installation-schema";
import type { ApprovalItem } from "@/lib/chat-contract";
import type { JsonValue } from "../../contracts/codex/0.149.1/types/serde_json/JsonValue";
import {
  FileApprovalStore,
  type ApprovalLocator,
} from "@/runtime/approval-store";

const OPERATION = "execute-allowlisted-action";

export type CodexManagedAppActionDescriptor = {
  operation: typeof OPERATION;
  locator: Pick<ApprovalLocator, "threadId" | "turnId" | "itemId" | "approvalId">;
  authorizationFingerprint: string;
  approval: ApprovalItem;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function correlationFrom(response: unknown, field: string) {
  if (!isRecord(response) || response.isError === true || !isRecord(response.structuredContent)) {
    throw new ConnectorError("CODEX_APP_TOOL_FAILED", "Codex MCP tool did not return a successful structured result.");
  }
  const value = response.structuredContent[field];
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new ConnectorError("CODEX_APP_CORRELATION_MISSING", "Codex MCP tool did not return the configured correlation value.");
  }
  return value;
}

function configuredArguments(argumentsValue: Record<string, unknown>): Record<string, JsonValue> {
  return structuredClone(argumentsValue) as Record<string, JsonValue>;
}

function actionFingerprint(config: CodexManagedAppActionConfig) {
  return connectorFingerprint(config);
}

/**
 * The only mutating connector entry point. Its server/tool/static arguments
 * are selected by InstallationConfig, never by a browser request. Approval is
 * an exact durable receipt; no boolean approval flag is accepted.
 */
export class CodexManagedAppAction {
  private readonly provider: CodexManagedAppProvider;

  constructor(
    private readonly bindings: FileConnectorBindingStore,
    private readonly authorizations: FileConnectorAuthorizationStore,
    private readonly approvals: FileApprovalStore,
    private readonly principal: ConnectorPrincipal,
    private readonly config: CodexManagedAppActionConfig,
    private readonly transportForUser: (userId: string) => Promise<CodexInstalledAppTransport>,
    private readonly permissionFingerprint: string,
    private readonly workspacePolicyFingerprint: string,
  ) {
    this.provider = new CodexManagedAppProvider(transportForUser);
  }

  private async binding() {
    const binding = await this.bindings.resolve(this.principal, CODEX_MANAGED_APP_CONNECTOR_ID, { allowShared: false });
    if (binding.userId === null || codexManagedAppIdForBinding(binding.credentialRef) !== this.config.appId) {
      throw new ConnectorError("CODEX_APP_ACTION_BINDING_MISMATCH", "Codex App binding does not match the installation allowlist.");
    }
    return binding;
  }

  private async revalidate(snapshot: ConnectorAuthorizationSnapshot) {
    const binding = await this.binding();
    assertAuthorizationFresh(snapshot, binding);
    if (snapshot.operation !== OPERATION || snapshot.resourceId !== actionFingerprint(this.config)) {
      throw new ConnectorError("CODEX_APP_ACTION_CONFIGURATION_CHANGED", "The installation action configuration changed after approval.");
    }
    const inspected = await this.provider.inspect({ principal: this.principal, binding });
    if (inspected.health.status !== "connected") {
      throw new ConnectorError("CODEX_APP_ACTION_HEALTH_UNAVAILABLE", "Codex App is not connected for the approved action.");
    }
    return inspected;
  }

  async prepare(locator: ApprovalLocator): Promise<CodexManagedAppActionDescriptor> {
    if (locator.installationId !== this.principal.installationId || locator.userId !== this.principal.userId) {
      throw new ConnectorError("CODEX_APP_ACTION_LOCATOR_MISMATCH", "Connector approval locator belongs to another principal.");
    }
    const binding = await this.binding();
    const inspected = await this.provider.inspect({ principal: this.principal, binding });
    if (inspected.health.status !== "connected") {
      throw new ConnectorError("CODEX_APP_ACTION_HEALTH_UNAVAILABLE", "Codex App is not connected for the configured action.");
    }
    const authorization = prepareConnectorAuthorization({
      principal: this.principal,
      definition: codexManagedAppDefinition,
      binding,
      operation: OPERATION,
      resourceId: actionFingerprint(this.config),
      args: this.config,
      permissionFingerprint: this.permissionFingerprint,
      workspacePolicyFingerprint: this.workspacePolicyFingerprint,
      allowSharedCredential: false,
    });
    await this.authorizations.put(locator, authorization);
    const prepared = await this.approvals.prepareConnectorApproval({
      locator,
      authorizationFingerprint: authorization.authorizationFingerprint,
    });
    if (!prepared.receipt) {
      throw new ConnectorError("CODEX_APP_ACTION_APPROVAL_UNAVAILABLE", "Connector approval could not be prepared.");
    }
    const visible = await this.approvals.createPending({ locator, requestType: "connector" });
    if (visible.status !== "pending") {
      throw new ConnectorError("CODEX_APP_ACTION_APPROVAL_UNAVAILABLE", "Connector approval is no longer pending.");
    }
    return {
      operation: OPERATION,
      locator: { threadId: locator.threadId, turnId: locator.turnId, itemId: locator.itemId, approvalId: locator.approvalId },
      authorizationFingerprint: authorization.authorizationFingerprint,
      approval: {
        id: locator.approvalId, threadId: locator.threadId, turnId: locator.turnId, itemId: locator.itemId,
        kind: "command", title: "Confirmar acción conectada", detail: "Ejecutar la acción aprobada de la aplicación conectada.", status: "pending",
      },
    };
  }

  async execute(input: Pick<CodexManagedAppActionDescriptor, "operation" | "locator" | "authorizationFingerprint">) {
    if (input.operation !== OPERATION) throw new ConnectorError("CONNECTOR_OPERATION_UNKNOWN", "Connector operation is not registered.");
    const locator: ApprovalLocator = { installationId: this.principal.installationId, userId: this.principal.userId, ...input.locator };
    const authorization = await this.authorizations.read(locator, input.authorizationFingerprint);
    if (authorization.principal.installationId !== this.principal.installationId || authorization.principal.userId !== this.principal.userId) {
      throw new ConnectorError("CODEX_APP_ACTION_RECEIPT_MISMATCH", "Connector authorization does not match the authenticated principal.");
    }
    const visible = await this.approvals.read(locator);
    if (!visible || visible.status !== "resolved" || visible.decision !== "accept") {
      throw new ConnectorError("CODEX_APP_ACTION_APPROVAL_PENDING", "Connector action requires one explicit approved pending item.");
    }
    const approved = await this.approvals.approveConnectorApprovalByLocator(locator, input.authorizationFingerprint);
    if (approved.outcome !== "approved" && approved.outcome !== "already-approved" &&
        approved.record?.status !== "executed" && approved.record?.status !== "indeterminate") {
      throw new ConnectorError("CODEX_APP_ACTION_APPROVAL_UNAVAILABLE", "Connector approval is not available for execution.");
    }
    return this.approvals.executeConnectorApprovalByLocator(locator, input.authorizationFingerprint, {
      revalidate: async () => {
        try {
          await this.revalidate(authorization);
          return true;
        } catch {
          return false;
        }
      },
      execute: async () => {
        const transport = await this.transportForUser(this.principal.userId);
        const actionResponse = await transport.request("mcpServer/tool/call", {
          threadId: locator.threadId,
          server: this.config.server,
          tool: this.config.tool,
          arguments: configuredArguments(this.config.arguments),
        }, "connector-codex-action", 10_000);
        const correlation = correlationFrom(actionResponse, this.config.correlationField);
        const readbackResponse = await transport.request("mcpServer/tool/call", {
          threadId: locator.threadId,
          server: this.config.readback.server,
          tool: this.config.readback.tool,
          arguments: {
            ...configuredArguments(this.config.readback.arguments),
            [this.config.readback.correlationArgument]: correlation,
          },
        }, "connector-codex-readback", 10_000);
        if (correlationFrom(readbackResponse, this.config.correlationField) !== correlation) {
          throw new ConnectorError("CODEX_APP_READBACK_MISSING", "Provider readback did not confirm the executed action.");
        }
        return { correlation };
      },
    });
  }
}
