import { describe, expect, it } from "vitest";
import { localMinuteToInstant, nextScheduledInstant } from "@/automations/schedule";

describe("automation schedules", () => {
  it("uses the first valid minute after the Madrid spring DST gap", () => {
    expect(localMinuteToInstant({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, "Europe/Madrid").toISOString())
      .toBe("2026-03-29T01:00:00.000Z");
  });

  it("uses the earliest instant during the Madrid autumn overlap", () => {
    expect(localMinuteToInstant({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, "Europe/Madrid").toISOString())
      .toBe("2026-10-25T00:30:00.000Z");
  });

  it("keeps weekly wall-clock time across DST", () => {
    expect(nextScheduledInstant(
      { kind: "weekly", weekdays: [1], hour: 9, minute: 0 },
      "Europe/Madrid",
      new Date("2026-03-27T12:00:00.000Z"),
    )).toBe("2026-03-30T07:00:00.000Z");
  });
});
