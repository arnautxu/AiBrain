import "server-only";
import { privateHorariaRequest } from "./private-transport";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import type { AuthSession } from "@/auth/types";
import type { InstallationConfig } from "@/config/installation-schema";
import { readRegularFileWithin } from "@/security/safe-file";
import { resolveOperation, type OperationInput } from "./operations";

export type HorariaConfig = { installationId: string; baseUrl: string; secret: string; users: Record<string, { employeeId: number; backgroundOperations: string[] }>; eventsEnabled: boolean; eventActorId?: string };
export async function loadHorariaConfig(installation: Readonly<InstallationConfig>): Promise<HorariaConfig> {
  const file = await open(path.join(installation.paths.dataRoot, "horaria", "integration.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 64_000 || (stat.mode & 0o077)) throw new Error("La configuración de horarios debe ser privada.");
    const c = JSON.parse(await file.readFile("utf8")) as HorariaConfig;
    const url = new URL(c.baseUrl);
    if (c.installationId !== installation.installationId || typeof c.secret !== "string" || c.secret.length < 32 ||
      !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || typeof c.eventsEnabled !== "boolean" || !c.users || typeof c.users !== "object" || Array.isArray(c.users)) throw new Error("Configuración de horarios no válida.");
    for (const user of Object.values(c.users)) {
      if (!Number.isSafeInteger(user.employeeId) || user.employeeId < 1 || !Array.isArray(user.backgroundOperations) || user.backgroundOperations.some(op => typeof op !== "string")) throw new Error("Asignación de horarios no válida.");
    }
    if (c.eventActorId !== undefined && (typeof c.eventActorId !== "string" || !Object.hasOwn(c.users, c.eventActorId))) throw new Error("Responsable de WhatsApp no válido.");
    return c;
  } finally { await file.close(); }
}

export function bridgeToken(config: HorariaConfig, request: { method: string; target: string; contentType: string; body: Uint8Array; kind: "user" | "event" | "scheduler"; actorId?: string; employeeId?: number; source?: "whatsapp" }) {
  const { body, ...claims } = request;
  const payload = Buffer.from(JSON.stringify({ ...claims, v: 1, installationId: config.installationId, timestamp: Date.now(), nonce: randomUUID(), bodyHash: createHash("sha256").update(body).digest("hex") })).toString("base64url");
  return `${payload}.${createHmac("sha256", config.secret).update(payload).digest("base64url")}`;
}

export async function callHoraria(config: HorariaConfig, session: AuthSession, input: OperationInput, projectWorkspace: string) {
  if (session.provider !== "local" || session.tenant.id !== config.installationId || !Object.hasOwn(config.users, session.user.id)) throw new Error("No tienes acceso a los horarios de esta instalación.");
  const op = resolveOperation(input);
  let body = Buffer.from(input.body ? JSON.stringify(input.body) : "");
  let contentType = body.length ? "application/json" : "";
  if (input.uploadPath) {
    if (path.isAbsolute(input.uploadPath) || input.uploadPath.split(/[\\/]/).includes("..")) throw new Error("La imagen debe pertenecer al proyecto actual.");
    const data = await readRegularFileWithin(projectWorkspace, input.uploadPath, 10 * 1024 * 1024);
    const mime = data.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "image/jpeg" : data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : null;
    if (!mime) throw new Error("Adjunta una imagen PNG o JPEG.");
    const form = new FormData();
    for (const [key, value] of Object.entries(input.body ?? {})) form.set(key, String(value));
    form.set("imagen", new Blob([new Uint8Array(data)], { type: mime }), path.basename(input.uploadPath));
    const serialized = new Request("http://localhost", { method: "POST", body: form });
    body = Buffer.from(await serialized.arrayBuffer());
    contentType = serialized.headers.get("content-type")!;
  }
  if (body.length > 12 * 1024 * 1024) throw new Error("Solicitud demasiado grande.");
  const token = bridgeToken(config, { method: op.method, target: op.target, contentType, body, kind: "user", actorId: session.user.id, employeeId: config.users[session.user.id].employeeId });
  const response = await privateHorariaRequest(config.baseUrl, op.target, { method: op.method, headers: { "x-aibrain-authorization": token, ...(contentType ? { "content-type": contentType } : {}) }, body: body.length ? body : undefined, signal: AbortSignal.timeout(op.effect === "ai" || op.effect === "draft" ? 20 * 60_000 : 90_000) });
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("Respuesta demasiado grande; filtra por tienda y semana.");
  if (!response.ok) throw new Error(`horarIA (${response.status}): ${text.slice(0, 1500)}`);
  // No password hashes, access tokens or provider secrets may enter the conversation.
  return JSON.parse(text, (key, value) => /password|secret|token|apikey|api_key/i.test(key) ? undefined : value) as unknown;
}
