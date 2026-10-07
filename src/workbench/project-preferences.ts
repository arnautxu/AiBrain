import { createHash } from "node:crypto";
import type { InstallationConfig } from "@/config/installation-schema";
import type { ResolvedPermissions } from "@/permissions";
import { FileWorkbenchStore } from "./filesystem-store";

export function requestsProjectPreferences(message: string) {
  const text = message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return /\b(?:proyecto|projecte|project|futuros?\s+chats?|futuras?\s+conversaciones|futures?\s+converses)\b/u.test(text)
    && /\b(?:actuali[zc]\w*|actualitz\w*|guard\w*|des[ai]\w*|record\w*|recuerd\w*|save|remember|ten\w*\s+en\s+cuenta|tingu\w*\s+en\s+compte)\b/u.test(text)
    && !/\b(?:no|not|don't|do not)\s+(?:\w+\s+){0,2}(?:actuali[zc]\w*|actualitz\w*|guard\w*|des[ai]\w*|record\w*|recuerd\w*|save|remember|ten\w*|tingu\w*)\b/u.test(text);
}

/** Current user request and current owned project only; never model-selected IDs. */
export async function saveProjectPreferences(input: {
  config: Readonly<InstallationConfig>; userId: string; ownerUserId?: string;
  projectId: string; threadId: string; message: string; notes: string;
  expectedNotes: string; permissions: ResolvedPermissions;
}) {
  if (!requestsProjectPreferences(input.message)) throw new Error("Pide explícitamente guardar o actualizar los criterios de este proyecto.");
  const p = input.permissions;
  const rules = p.rules.filter(rule => rule.ruleId === "tools.execute" && rule.action === "execute");
  if (p.installationId !== input.config.installationId || p.userId !== input.userId || p.projectId !== input.projectId ||
      !rules.some(rule => rule.effect === "allow") || rules.some(rule => rule.effect === "deny") || input.ownerUserId !== input.userId) {
    throw new Error("No se pueden autorizar los criterios de este proyecto.");
  }
  if (typeof input.notes !== "string" || !input.notes.trim() || input.notes.length > 16000 || /\p{C}/u.test(input.notes.replace(/[\t\r\n]/g, ""))) throw new Error("Los criterios no son válidos.");
  const store = FileWorkbenchStore.fromInstallation(input.config);
  const thread = await store.getThread(input.userId, input.threadId);
  if (thread.projectId !== input.projectId) throw new Error("La conversación no pertenece a este proyecto.");
  const project = await store.updateProjectPreferences(input.userId, input.projectId, input.expectedNotes, input.notes.trim());
  return { status: "saved", projectId: project.id, updatedAt: project.memory.updatedAt,
    sha256: createHash("sha256").update(project.memory.notes).digest("hex"), notes: project.memory.notes,
    availableIn: "all conversations in this project" };
}
