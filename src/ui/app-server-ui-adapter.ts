import { isChatStreamEvent, type ChatStreamEvent } from "@/lib/chat-contract";

const MAX_EVENT_LINE_LENGTH = 1_000_000;

export class ChatStreamProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatStreamProtocolError";
  }
}

function parseEvent(line: string): ChatStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ChatStreamProtocolError("El servicio ha enviado una respuesta incompleta.");
  }
  if (!isChatStreamEvent(value)) {
    throw new ChatStreamProtocolError("El servicio ha enviado un evento no compatible.");
  }
  return value;
}

export async function consumeChatEventStream(
  response: Response,
  onEvent: (event: ChatStreamEvent) => void,
  options: { signal?: AbortSignal } = {},
) {
  if (!response.body) {
    throw new ChatStreamProtocolError("La respuesta no contiene datos.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abortError = () => options.signal?.reason instanceof Error
    ? options.signal.reason
    : new DOMException("La lectura del stream se ha cancelado.", "AbortError");
  const onAbort = () => { void reader.cancel(abortError()); };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const applyLine = (line: string) => {
    if (!line.trim()) return;
    if (line.length > MAX_EVENT_LINE_LENGTH) {
      throw new ChatStreamProtocolError("El evento recibido supera el límite permitido.");
    }
    onEvent(parseEvent(line));
  };

  try {
    if (options.signal?.aborted) throw abortError();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_EVENT_LINE_LENGTH && !buffer.includes("\n")) {
        throw new ChatStreamProtocolError("El evento recibido supera el límite permitido.");
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(applyLine);
    }
    buffer += decoder.decode();
    applyLine(buffer);
    if (options.signal?.aborted) throw abortError();
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
