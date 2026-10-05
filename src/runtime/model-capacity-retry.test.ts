import { describe, expect, it } from "vitest";
import { capacityFallback, isRejectedModelAdmission } from "./model-capacity-retry";
import type { RuntimeModelOption } from "@/lib/runtime-status";

const rejection = { id: "turn-1", status: "failed", error: { codexErrorInfo: "serverOverloaded" },
  items: [{ type: "userMessage", clientId: "user-1" }] };

describe("empty model admission rejection", () => {
  it("selects only available compatible alternatives, retaining effort or their supported default", () => {
    const models: RuntimeModelOption[] = ["gpt-5.6-sol", "gpt-6-astra", "gpt-5.6-terra"].map(id => ({
      id, label: id, description: "", isDefault: false, inputModalities: ["text", "image"],
      supportedReasoningEfforts: ["low", "medium"], defaultReasoningEffort: "low", supportsPersonality: false,
    }));
    const input = { originalModel: "gpt-6-astra", currentModel: "gpt-6-astra", effort: "medium" as const,
      models, requiresImages: true, imageGeneration: false };
    expect(capacityFallback(input)).toEqual({ model: "gpt-5.6-sol", effort: "medium" });
    expect(capacityFallback({ ...input, currentModel: "gpt-5.6-sol" })).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
    expect(capacityFallback({ ...input, effort: "ultra" })).toEqual({ model: "gpt-5.6-sol", effort: "low" });
    for (const override of [{ models: [] }, { originalModel: "custom-model" }, { imageGeneration: true },
      { models: models.map(model => ({ ...model, inputModalities: ["text" as const] })) }]) {
      expect(capacityFallback({ ...input, ...override })).toBeNull();
    }
  });
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
