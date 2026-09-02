import type { DynamicToolCallParams } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../../contracts/codex/0.149.1/types/v2/DynamicToolSpec";
import {
  EnterpriseDocumentNetwork,
  type EnterpriseDocumentRoot,
  type EnterpriseDocumentScope,
} from "@/documents/enterprise-document-network";
import type { OnDemandDocumentSync } from "@/documents/on-demand-sync";
import { isServerDirectoryQuery, isServerFilePath, type ServerDocumentFiles } from "@/documents/server-files";

export const AIBRAIN_COMPANY_FILES_TOOL_NAMESPACE = "aibrain_company_files";

export const COMPANY_FILES_DYNAMIC_TOOLS: readonly DynamicToolSpec[] = Object.freeze([{
  type: "namespace",
  name: AIBRAIN_COMPANY_FILES_TOOL_NAMESPACE,
  description: "Search and read only the company, department, current-project and private employee files authorized by the server for this turn. Returned paths are relative and never grant access to another scope.",
  tools: [{
    type: "function",
    name: "search",
    description: "Find authorized business files in local text and, when connected, by name on the Windows server. To browse live drives use query server:/; to list a folder use server:/Y/PRESSUPOSTOS or a Windows drive path. Follow nextQuery for more entries. Recursive name searches are bounded: inspect server.limited and warnings. Use the returned server-connection/... path with read; no Windows writes are available.",
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
    description: "Read an authorized business file using the scope and path returned by search. Paths starting server- read fresh Windows files through the read-only connection; follow nextPath for more text and compare hashes across parts. Other paths read scoped UTF-8 copies refreshed first. Report unavailable formats, source failures and synchronization warnings accurately.",
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
  sync?: OnDemandDocumentSync;
  serverFiles?: ServerDocumentFiles;
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
          (params.arguments.limit !== undefined && (!Number.isSafeInteger(params.arguments.limit) || Number(params.arguments.limit) < 1))) {
        return { success: false, contentItems: [{ type: "inputText", text: "Parámetros de búsqueda no válidos. Usa query como texto y limit como entero positivo, con un máximo de 50 resultados por página. Corrige los parámetros y vuelve a consultar; este error no indica falta de permisos sobre la carpeta." }] };
      }
      const input = {
        roots: context.roots,
        query: params.arguments.query,
        // Runtime calls may exceed the advertised page size. Cap work before
        // either backend; a larger requested page is not a scope violation.
        ...(typeof params.arguments.limit === "number" ? { limit: Math.min(params.arguments.limit, 50) } : {}),
      };
      if (isServerDirectoryQuery(input.query)) {
        const server = await context.serverFiles?.search(context.roots, input.query, input.limit);
        return response({ results: server?.results ?? [], server: server ?? { available: false },
          warning: server?.warning ?? (server ? undefined : "El acceso directo al servidor no está disponible para este turno.") });
      }
      // Validate query and issued roots before any host effect. Then search the
      // new atomic snapshot, including files that were missing from the copy.
      let results = await context.network.search(input);
      const server = await context.serverFiles?.search(context.roots, input.query, input.limit);
      if (server) return response({ results: [...results, ...(server.results ?? [])], server,
        warning: "Los resultados locales son copias. Los resultados del servidor reflejan la consulta indicada; revisa limited, truncated y nextQuery antes de afirmar que una búsqueda es completa." });
      const synchronization = await context.sync?.refresh(context.roots) ?? [];
      if (synchronization.length) results = await context.network.search(input);
      return response({ results, synchronization,
        ...(results.length === 0 ? {
          warning: "No se han encontrado coincidencias en las copias y ámbitos autorizados. Esta búsqueda no es un inventario completo del servidor ni de sus unidades. Incluso con synchronization=current, no demuestra que el archivo o carpeta no exista en la fuente; puede estar fuera de las carpetas configuradas, no sincronizado o no ser legible. Explica este límite y solicita revisar la carpeta configurada sin ampliar el acceso por tu cuenta.",
        } : {}),
      });
    }
    if (params.tool === "read") {
      const keys = Object.keys(params.arguments);
      if (keys.some((key) => key !== "scope" && key !== "scopeId" && key !== "path") ||
          !["company", "department", "project", "private"].includes(String(params.arguments.scope)) ||
          typeof params.arguments.path !== "string" ||
          !(params.arguments.scopeId === undefined || params.arguments.scopeId === null || typeof params.arguments.scopeId === "string")) {
        return failure();
      }
      const input = {
        roots: context.roots,
        scope: params.arguments.scope as EnterpriseDocumentScope,
        scopeId: params.arguments.scopeId as string | null | undefined,
        path: params.arguments.path,
      };
      if (isServerFilePath(input.path)) {
        const result = await context.serverFiles?.read(context.roots, input);
        return response(result ?? { available: false, warning: "El acceso directo al servidor no está disponible para este turno." });
      }
      await context.network.validateSyncRead(input);
      const synchronization = await context.sync?.refresh(context.roots, input) ?? [];
      try {
        return response({ ...await context.network.read(input), synchronization });
      } catch (error) {
        if (synchronization.some((item) => item.state !== "current")) {
          return response({ available: false, synchronization, warning: "No se pudo actualizar ni leer la copia solicitada. No afirmes que el archivo no existe en la fuente." });
        }
        throw error;
      }
    }
    return failure();
  } catch {
    return failure();
  }
}
