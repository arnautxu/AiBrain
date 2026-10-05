import { describe, expect, it } from "vitest";
import { isRejectedModelAdmission } from "./model-capacity-retry";

const rejection = { id: "turn-1", status: "failed", error: { codexErrorInfo: "serverOverloaded" },
  items: [{ type: "userMessage", clientId: "user-1" }] };

describe("empty model admission rejection", () => {
  it("requires an exact failed turn, structured capacity code and sole matching user input", () => {
    expect(isRejectedModelAdmission(rejection, "turn-1", "user-1")).toBe(true);
    for (const turn of [null, { ...rejection, id: "foreign-turn" }, { ...rejection, status: "inProgress" },
      { ...rejection, error: { message: "Selected model is at capacity. Please try a different model." } },
      { ...rejection, error: { codexErrorInfo: "usageLimitExceeded" } },
      { ...rejection, items: [] }, { ...rejection, items: [{ type: "userMessage", clientId: "other-user" }] },
      ...["agentMessage", "reasoning", "commandExecution", "dynamicToolCall", "fileChange"].map(type =>
        ({ ...rejection, items: [...rejection.items, { type }] }))]) {
      expect(isRejectedModelAdmission(turn, "turn-1", "user-1")).toBe(false);
    }
  });
});
