import type { RuntimeModelOption, RuntimeReasoningEffort } from "@/lib/runtime-status";

/** Only a confirmed, empty provider admission failure can authorize another
 * model submission. Transport failures and partial work never qualify. */
export const MODEL_CAPACITY_RETRY_DELAYS_MS = [5_000, 15_000] as const;
export const MODEL_CAPACITY_MESSAGE = "El servicio de IA está temporalmente saturado. La conversación y los adjuntos se conservan. Vuelve a intentarlo en unos minutos.";

export type CapacityModel = { model: string; effort: RuntimeReasoningEffort | null };
const ALTERNATIVES: Record<string, readonly string[]> = {
  "gpt-6-astra": ["gpt-5.6-sol", "gpt-5.6-terra"],
  "gpt-5.6-sol": ["gpt-6-astra", "gpt-5.6-terra"],
  "gpt-5.6-terra": ["gpt-5.6-sol", "gpt-6-astra"],
};

export function capacityFallback(input: {
  originalModel: string | null; currentModel: string | null;
  effort: RuntimeReasoningEffort | null; models: readonly RuntimeModelOption[];
  requiresImages: boolean; imageGeneration: boolean;
}): CapacityModel | null {
  // Only product-supported families with a fresh positive catalog match.
  // Image-generation capabilities are not advertised per model in this catalog.
  if (!input.originalModel || input.imageGeneration) return null;
  for (const id of ALTERNATIVES[input.originalModel] ?? []) {
    if (id === input.currentModel) continue;
    const model = input.models.find(value => value.id === id);
    if (!model || !model.inputModalities.includes("text") ||
        (input.requiresImages && !model.inputModalities.includes("image"))) continue;
    const effort = input.effort && model.supportedReasoningEfforts.includes(input.effort)
      ? input.effort : model.defaultReasoningEffort;
    if (effort && !model.supportedReasoningEfforts.includes(effort)) continue;
    return { model: id, effort };
  }
  return null;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isModelCapacityError(error: unknown) {
  return record(error) && error.codexErrorInfo === "serverOverloaded";
}

export function isRejectedModelAdmission(turn: unknown, turnId: string, clientUserMessageId: string) {
  return record(turn) && turn.id === turnId && turn.status === "failed" &&
    isModelCapacityError(turn.error) && Array.isArray(turn.items) && turn.items.length === 1 &&
    turn.items.every(item => record(item) && item.type === "userMessage" && item.clientId === clientUserMessageId);
}

export class ModelCapacityRetryReady extends Error {
  constructor() { super("A confirmed empty capacity rejection has a durable retry intent."); }
}
