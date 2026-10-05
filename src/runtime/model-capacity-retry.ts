/** Only a confirmed, empty provider admission failure can authorize another
 * model submission. Transport failures and partial work never qualify. */
export const MODEL_CAPACITY_RETRY_DELAYS_MS = [5_000, 15_000] as const;
export const MODEL_CAPACITY_MESSAGE = "El servicio de IA está temporalmente saturado. La conversación y los adjuntos se conservan. Vuelve a intentarlo en unos minutos.";

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
