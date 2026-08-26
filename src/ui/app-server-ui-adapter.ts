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
) {
  if (!response.body) {
    throw new ChatStreamProtocolError("La respuesta no contiene datos.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const applyLine = (line: string) => {
    if (!line.trim()) return;
    if (line.length > MAX_EVENT_LINE_LENGTH) {
      throw new ChatStreamProtocolError("El evento recibido supera el límite permitido.");
    }
    onEvent(parseEvent(line));
  };

  try {
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
  } finally {
    reader.releaseLock();
  }
}
