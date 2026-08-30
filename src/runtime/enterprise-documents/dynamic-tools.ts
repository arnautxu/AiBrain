import type { DynamicToolCallParams } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolSpec";
import {
  EnterpriseDocumentNetwork,
  type EnterpriseDocumentRoot,
  type EnterpriseDocumentScope,
} from "@/documents/enterprise-document-network";

export const AIBRAIN_COMPANY_FILES_TOOL_NAMESPACE = "aibrain_company_files";

export const COMPANY_FILES_DYNAMIC_TOOLS: readonly DynamicToolSpec[] = Object.freeze([{
  type: "namespace",
  name: AIBRAIN_COMPANY_FILES_TOOL_NAMESPACE,
  description: "Search and read only the company, department, current-project and private employee files authorized by the server for this turn. Returned paths are relative and never grant access to another scope.",
  tools: [{
    type: "function",
    name: "search",
    description: "Find authorized business files by name or UTF-8 text. Use this before read when the exact relative path is unknown.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  }, {
    type: "function",
    name: "read",
    description: "Read one authorized UTF-8 business file using the scope, optional department id and relative path returned by search.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["company", "department", "project", "private"] },
        scopeId: { type: ["string", "null"], maxLength: 36 },
        path: { type: "string", minLength: 1, maxLength: 1024 },
      },
      required: ["scope", "path"],
      additionalProperties: false,
    },
  }],
}]);

type Context = Readonly<{
  network: EnterpriseDocumentNetwork;
  roots: readonly EnterpriseDocumentRoot[];
  runtimeThreadId: string;
  runtimeTurnId: string;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function response(value: unknown): DynamicToolCallResponse {
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

function failure(): DynamicToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: "El archivo solicitado no está autorizado o no es seguro para este turno." }],
  };
}

export async function handleCompanyFilesDynamicToolCall(params: DynamicToolCallParams, context: Context) {
  try {
    if (!record(params) || params.namespace !== AIBRAIN_COMPANY_FILES_TOOL_NAMESPACE ||
        params.threadId !== context.runtimeThreadId || params.turnId !== context.runtimeTurnId || !record(params.arguments)) {
      return failure();
    }
    if (params.tool === "search") {
      const keys = Object.keys(params.arguments);
      if (keys.some((key) => key !== "query" && key !== "limit") || typeof params.arguments.query !== "string" ||
          (params.arguments.limit !== undefined && (!Number.isSafeInteger(params.arguments.limit) || Number(params.arguments.limit) < 1 || Number(params.arguments.limit) > 50))) {
        return failure();
      }
      const results = await context.network.search({
        roots: context.roots,
        query: params.arguments.query,
        ...(typeof params.arguments.limit === "number" ? { limit: params.arguments.limit } : {}),
      });
      return response({ results });
    }
    if (params.tool === "read") {
      const keys = Object.keys(params.arguments);
      if (keys.some((key) => key !== "scope" && key !== "scopeId" && key !== "path") ||
          !["company", "department", "project", "private"].includes(String(params.arguments.scope)) ||
          typeof params.arguments.path !== "string" ||
          !(params.arguments.scopeId === undefined || params.arguments.scopeId === null || typeof params.arguments.scopeId === "string")) {
        return failure();
      }
      return response(await context.network.read({
        roots: context.roots,
        scope: params.arguments.scope as EnterpriseDocumentScope,
        scopeId: params.arguments.scopeId as string | null | undefined,
        path: params.arguments.path,
      }));
    }
    return failure();
  } catch {
    return failure();
  }
}
