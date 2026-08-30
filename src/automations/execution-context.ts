import type { TurnOptions } from "@/lib/chat-contract";

export function scheduledTurnOptions(input: {
  skillsAuthorized: boolean;
  connectorMentions: string[];
}): TurnOptions {
  return {
    mode: "agent",
    model: null,
    effort: null,
    webSearch: true,
    imageGeneration: false,
    skill: null,
    inheritAuthorizedSkills: input.skillsAuthorized,
    connectorMentions: [...input.connectorMentions],
    attachments: [],
  };
}
