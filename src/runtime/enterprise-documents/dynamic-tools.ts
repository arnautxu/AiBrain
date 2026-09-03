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
import { isKnowledgeFilePath, type KnowledgeCalculation, type KnowledgeDocumentFiles } from "@/documents/knowledge-files";

export const AIBRAIN_COMPANY_FILES_TOOL_NAMESPACE = "aibrain_company_files";

export const COMPANY_FILES_DYNAMIC_TOOLS: readonly DynamicToolSpec[] = Object.freeze([{
  type: "namespace",
  name: AIBRAIN_COMPANY_FILES_TOOL_NAMESPACE,
  description: "Search and read only the company, department, current-project and private employee files authorized by the server for this turn. Returned paths are relative and never grant access to another scope.",
  tools: [{
    type: "function",
    name: "search",
    description: "Find authorized business files in the metadata map, indexed library and local text. To discover drives use server:/, then navigate observed folders. Never invent a year folder: inspect the parent. Names may use Catalan (pressupostos) or Spanish (presupuestos); use observed names and try their equivalents. Known complete folders use the map; unscanned folders use live listing. Follow nextQuery for further pages. To count or classify a folder tree use inventory with its returned server- path; search result counts are not totals. Read knowledge- paths with returned scope/scopeId for indexed source versions. No Windows writes are available.",
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
    name: "inventory",
    description: "Count and list files throughout an observed server folder and its subfolders. Use the company scope and server- directory path returned by search. Totals cover the whole known subtree, independent of the 50-file result page; pass nextOffset to see remaining files. If enumerationComplete=false with pending directories, this call prioritizes bounded live metadata discovery. Repeat the same path at offset 0 while discovery.state=CONTINUE; BUSY means retry later, other failures need explanation. Do not add totals from successive calls. Classify using filenames, then read relevant documents to verify type, issuer, date and quote identifier. fileCount counts files, not unique quotes: exclude catalogs/images/annexes, group confirmed versions/copies, distinguish issued from received quotes. Folder or modification year does not prove document year. Explain count criteria and scope; do not claim a company-wide total from one folder, or zero from partial coverage.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["company"] },
        path: { type: "string", minLength: 1, maxLength: 1024 },
        offset: { type: "integer", minimum: 0, maximum: 500000 },
      },
      required: ["scope", "path"],
      additionalProperties: false,
    },
  }, {
    type: "function",
    name: "read",
    description: "Read an authorized business file using the scope, scopeId and path returned by search. Paths starting knowledge- read version-bound indexed copies with page/paragraph/cell locators; these are not fresh source checks. Follow tables[].path to inspect preserved source tables and nextPath for additional text or table entries. Paths starting server- read fresh Windows files through the read-only connection. Other paths read scoped UTF-8 copies refreshed first. Report unavailable formats, source failures, previewTruncated and synchronization warnings accurately.",
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
  }, {
    type: "function",
    name: "calculate",
    description: "Calculate a decimal sum, count, minimum, maximum or mean from an indexed source table after inspecting it with read. Use the returned scope, scopeId, knowledge path and table index. Explicitly select at most 500 unique XLSX cell addresses, or 1-based CSV/DOCX row numbers and a column. Exclude headers and totals deliberately. Set the numeric locale: es uses decimal comma, en uses decimal point and comma grouping, canonical has no grouping. Non-numeric selections fail. Saved formulas are not recalculated. Explain the selection, source version, units and coverage; this never infers business meaning or writes source files.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["company", "department", "project", "private"] },
        scopeId: { type: ["string", "null"], maxLength: 36 },
        path: { type: "string", minLength: 1, maxLength: 1024 },
        tableIndex: { type: "integer", minimum: 0, maximum: 9999 },
        selection: { type: "object", properties: {
          cells: { type: "array", items: { type: "string", maxLength: 16 }, minItems: 1, maxItems: 500 },
          rows: { type: "array", items: { type: "integer", minimum: 1, maximum: 1000000 }, minItems: 1, maxItems: 500 },
          column: { type: "integer", minimum: 1, maximum: 10000 },
        }, additionalProperties: false },
        operation: { type: "string", enum: ["sum", "count", "min", "max", "mean"] },
        locale: { type: "string", enum: ["canonical", "es", "en"] },
      },
      required: ["scope", "path", "tableIndex", "selection", "operation", "locale"],
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
  knowledgeFiles?: KnowledgeDocumentFiles;
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
      // Older App Server threads retain their original dynamic-tool schema.
      // Route this bounded query through the same inventory authorization.
      if (input.query.startsWith("inventory:")) {
        if (input.query.length > 200) return failure();
        const [path, query, extra] = input.query.slice(10).split("?");
        if (extra !== undefined || !isServerFilePath(path) || (query !== undefined && !/^offset=[0-9]{1,6}$/.test(query))) return failure();
        return response(await context.serverFiles?.inventory(context.roots, { scope: "company", path,
          offset: query === undefined ? 0 : Number(query.slice(7)) }) ?? { available: false });
      }
      if (isServerDirectoryQuery(input.query)) {
        const server = await context.serverFiles?.search(context.roots, input.query, input.limit);
        return response({ results: server?.results ?? [], server: server ?? { available: false },
          warning: server?.warning ?? (server ? undefined : "El acceso directo al servidor no está disponible para este turno.") });
      }
      // Validate query and issued roots before any host effect. Then search the
      // new atomic snapshot, including files that were missing from the copy.
      let results = await context.network.search(input);
      const server = await context.serverFiles?.search(context.roots, input.query, input.limit);
      const knowledge = await context.knowledgeFiles?.search(context.roots, input.query, input.limit);
      if (server?.available) return response({ results: [...results, ...(server.results ?? []), ...(knowledge?.available ? knowledge.results ?? [] : [])], server,
        ...(knowledge?.available ? { knowledge } : {}),
        warning: server.warning ?? "Resultados del mapa del servidor y de copias autorizadas; revisa cobertura y fechas antes de afirmar que el origen está actualizado." });
      if (knowledge?.available) return response({ results: [...results, ...(knowledge.results ?? [])], knowledge,
        warning: "Resultados de copias indexadas autorizadas, con cobertura parcial y fechas de observación. La búsqueda del servidor no está disponible; un resultado vacío no demuestra ausencia en el origen." });
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
    if (params.tool === "inventory") {
      const args = params.arguments;
      if (Object.keys(args).some((key) => !["scope", "path", "offset"].includes(key)) ||
        args.scope !== "company" || typeof args.path !== "string" || !isServerFilePath(args.path) ||
        (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || Number(args.offset) < 0 || Number(args.offset) > 500000))) return failure();
      return response(await context.serverFiles?.inventory(context.roots, { scope: "company", path: args.path, offset: args.offset as number | undefined }) ??
        { available: false, warning: "El inventario del servidor no está disponible para este turno." });
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
      if (isKnowledgeFilePath(input.path)) {
        return response(await context.knowledgeFiles?.read(context.roots, input) ??
          { available: false, warning: "El índice no está disponible para este turno." });
      }
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
    if (params.tool === "calculate") {
      const args = params.arguments;
      if (Object.keys(args).some((key) => !["scope", "scopeId", "path", "tableIndex", "selection", "operation", "locale"].includes(key)) ||
        !["company", "department", "project", "private"].includes(String(args.scope)) || typeof args.path !== "string" ||
        !isKnowledgeFilePath(args.path) || args.path.length > 1024 ||
        !(args.scopeId === undefined || args.scopeId === null || typeof args.scopeId === "string") ||
        !Number.isInteger(args.tableIndex) || Number(args.tableIndex) < 0 || Number(args.tableIndex) > 9999 ||
        !["sum", "count", "min", "max", "mean"].includes(String(args.operation)) ||
        !["canonical", "es", "en"].includes(String(args.locale)) || !record(args.selection)) return failure();
      const selection = args.selection;
      const cells = Object.keys(selection).length === 1 && Array.isArray(selection.cells) &&
        selection.cells.length > 0 && selection.cells.length <= 500 &&
        selection.cells.every((cell) => typeof cell === "string" && /^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(cell));
      const rows = Object.keys(selection).length === 2 && Array.isArray(selection.rows) &&
        selection.rows.length > 0 && selection.rows.length <= 500 &&
        selection.rows.every((row) => typeof row === "number" && Number.isInteger(row) && row >= 1 && row <= 1000000) &&
        Number.isInteger(selection.column) && Number(selection.column) >= 1 && Number(selection.column) <= 10000;
      if (!cells && !rows) return failure();
      return response(await context.knowledgeFiles?.calculate(context.roots, args as unknown as KnowledgeCalculation) ??
        { available: false, warning: "El cálculo necesita una tabla indexada autorizada disponible." });
    }
    return failure();
  } catch {
    return failure();
  }
}
