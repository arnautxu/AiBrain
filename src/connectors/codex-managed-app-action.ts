import { connectorFingerprint } from "@/connectors/canonical";
import { assertAuthorizationFresh, prepareConnectorAuthorization } from "@/connectors/authorization";
import { FileConnectorBindingStore } from "@/connectors/binding-store";
import {
  CODEX_MANAGED_APP_CONNECTOR_ID,
  CodexManagedAppProvider,
  codexManagedAppDefinition,
  codexManagedAppIdForBinding,
  type CodexInstalledAppTransport,
} from "@/connectors/codex-managed-app-provider";
import { ConnectorError, type ConnectorAuthorizationSnapshot, type ConnectorPrincipal } from "@/connectors/contracts";
import type { CodexManagedAppActionConfig } from "@/config/installation-schema";
import type { JsonValue } from "../../contracts/codex/0.149.1/types/serde_json/JsonValue";
import {
  FileApprovalStore,
  type ApprovalLocator,
  type ConnectorApprovalReceipt,
} from "@/runtime/approval-store";

const OPERATION = "execute-allowlisted-action";

export type PreparedCodexManagedAppAction = {
  receipt: ConnectorApprovalReceipt;
  authorization: ConnectorAuthorizationSnapshot;
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

  async prepare(locator: ApprovalLocator): Promise<PreparedCodexManagedAppAction> {
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
    const prepared = await this.approvals.prepareConnectorApproval({
      locator,
      authorizationFingerprint: authorization.authorizationFingerprint,
    });
    if (!prepared.receipt) {
      throw new ConnectorError("CODEX_APP_ACTION_APPROVAL_UNAVAILABLE", "Connector approval could not be prepared.");
    }
    return { receipt: prepared.receipt, authorization };
  }

  async execute(input: PreparedCodexManagedAppAction) {
    if (input.receipt.installationId !== this.principal.installationId || input.receipt.userId !== this.principal.userId ||
        input.authorization.principal.installationId !== this.principal.installationId ||
        input.authorization.principal.userId !== this.principal.userId ||
        input.receipt.authorizationFingerprint !== input.authorization.authorizationFingerprint) {
      throw new ConnectorError("CODEX_APP_ACTION_RECEIPT_MISMATCH", "Connector receipt does not match the authenticated principal.");
    }
    return this.approvals.executeConnectorApproval(input.receipt, {
      revalidate: async () => {
        try {
          await this.revalidate(input.authorization);
          return true;
        } catch {
          return false;
        }
      },
      execute: async () => {
        const transport = await this.transportForUser(this.principal.userId);
        const actionResponse = await transport.request("mcpServer/tool/call", {
          threadId: input.receipt.threadId,
          server: this.config.server,
          tool: this.config.tool,
          arguments: configuredArguments(this.config.arguments),
        }, "connector-codex-action", 10_000);
        const correlation = correlationFrom(actionResponse, this.config.correlationField);
        const readbackResponse = await transport.request("mcpServer/tool/call", {
          threadId: input.receipt.threadId,
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
