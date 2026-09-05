import { describe, expect, it } from "vitest";
import {
  BROWSER_RUNTIME_CAPABILITIES,
  browserRuntimeCapabilityInventory,
} from "@/runtime/browser/capabilities";
import { BROWSER_DYNAMIC_TOOLS } from "@/runtime/browser/dynamic-tools";

describe("browser runtime capability discovery", () => {
  it("announces every visible viewer control and keeps agent tools aligned with the dynamic registry", () => {
    const namespace = BROWSER_DYNAMIC_TOOLS[0];
    expect(namespace.type).toBe("namespace");
    if (namespace.type !== "namespace") throw new Error("browser namespace missing");
    const announcedTools = namespace.tools.map((tool) => tool.name);

    expect(browserRuntimeCapabilityInventory()).toEqual(BROWSER_RUNTIME_CAPABILITIES);
    expect(BROWSER_RUNTIME_CAPABILITIES.viewerControls).toEqual([
      "url", "back", "forward", "reload", "continuous-scroll", "fullscreen",
    ]);
    expect(BROWSER_RUNTIME_CAPABILITIES.agentTools).toEqual(announcedTools);
    expect(namespace.description).toContain("URL, back, forward, reload, continuous scroll and fullscreen");
  });
});
