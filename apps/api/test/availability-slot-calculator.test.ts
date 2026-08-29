import { describe, expect, it } from "vitest";
import {
  AvailabilityCalculationError,
  calculateAvailableSlots,
  type BusyInterval,
} from "../src/availability/slot-calculator.js";
import type { AvailabilityPolicy } from "../src/availability/weekly-policy.js";

const bogotaPolicy: AvailabilityPolicy = {
  bookingWindowDays: 1,
  minimumNoticeMinutes: 120,
  slotDurationMinutes: 30,
  timeZone: "America/Bogota",
  windows: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
};

function startsAt(
  policy: AvailabilityPolicy,
  now: string,
  busyIntervals: readonly BusyInterval[] = [],
): string[] {
  return calculateAvailableSlots({
    busyIntervals,
    now: new Date(now),
    policy,
  }).map((slot) => slot.startAt.toISOString());
}

describe("availability slot calculation", () => {
  it("applies notice, local windows, fixed slot duration, and opaque busy overlap", () => {
    const slots = calculateAvailableSlots({
      busyIntervals: [
        {
          endAt: new Date("2026-09-07T15:45:00.000Z"),
          startAt: new Date("2026-09-07T15:15:00.000Z"),
        },
      ],
      now: new Date("2026-09-07T12:10:00.000Z"),
      policy: bogotaPolicy,
    });

    expect(
      slots.map((slot) => ({
        endAt: slot.endAt.toISOString(),
        startAt: slot.startAt.toISOString(),
      })),
    ).toEqual([
      {
        endAt: "2026-09-07T15:00:00.000Z",
        startAt: "2026-09-07T14:30:00.000Z",
      },
      {
        endAt: "2026-09-07T16:30:00.000Z",
        startAt: "2026-09-07T16:00:00.000Z",
      },
      {
        endAt: "2026-09-07T17:00:00.000Z",
        startAt: "2026-09-07T16:30:00.000Z",
      },
    ]);
  });

  it("does not treat an interval touching a slot boundary as busy", () => {
    expect(
      startsAt(bogotaPolicy, "2026-09-07T12:10:00.000Z", [
        {
          endAt: new Date("2026-09-07T14:30:00.000Z"),
          startAt: new Date("2026-09-07T14:00:00.000Z"),
        },
        {
          endAt: new Date("2026-09-07T17:30:00.000Z"),
          startAt: new Date("2026-09-07T17:00:00.000Z"),
        },
      ]),
    ).toEqual([
      "2026-09-07T14:30:00.000Z",
      "2026-09-07T15:00:00.000Z",
      "2026-09-07T15:30:00.000Z",
      "2026-09-07T16:00:00.000Z",
      "2026-09-07T16:30:00.000Z",
    ]);
  });

  it("skips nonexistent wall times during spring-forward", () => {
    expect(
      startsAt(
        {
          ...bogotaPolicy,
          minimumNoticeMinutes: 0,
          timeZone: "America/New_York",
          windows: [{ endMinute: 240, startMinute: 60, weekday: 7 }],
        },
        "2026-03-08T05:00:00.000Z",
      ),
    ).toEqual([
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T06:30:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T07:30:00.000Z",
    ]);
  });

  it("returns distinct instants for both occurrences during fall-back", () => {
    expect(
      startsAt(
        {
          ...bogotaPolicy,
          minimumNoticeMinutes: 0,
          timeZone: "America/New_York",
          windows: [{ endMinute: 120, startMinute: 60, weekday: 7 }],
        },
        "2026-11-01T04:00:00.000Z",
      ),
    ).toEqual([
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ]);
  });

  it("advances the booking horizon by tenant-local calendar days", () => {
    expect(
      startsAt(
        {
          ...bogotaPolicy,
          minimumNoticeMinutes: 0,
          slotDurationMinutes: 60,
          timeZone: "America/New_York",
          windows: [{ endMinute: 780, startMinute: 660, weekday: 7 }],
        },
        "2026-03-07T17:00:00.000Z",
      ),
    ).toEqual(["2026-03-08T15:00:00.000Z"]);
  });

  it("returns no candidates for an explicitly unavailable schedule", () => {
    expect(
      startsAt(
        { ...bogotaPolicy, minimumNoticeMinutes: 0, windows: [] },
        "2026-09-07T12:00:00.000Z",
      ),
    ).toEqual([]);
  });

  it.each([
    ["invalid now", new Date("invalid"), []],
    [
      "invalid busy interval",
      new Date("2026-09-07T12:00:00.000Z"),
      [
        {
          endAt: new Date("2026-09-07T13:00:00.000Z"),
          startAt: new Date("2026-09-07T14:00:00.000Z"),
        },
      ],
    ],
  ] as const)("rejects %s with one stable error", (_label, now, busyIntervals) => {
    expect(() =>
      calculateAvailableSlots({ busyIntervals, now, policy: bogotaPolicy }),
    ).toThrow(AvailabilityCalculationError);
  });

  it("exports one privacy-safe calculation error", () => {
    expect(new AvailabilityCalculationError()).toMatchObject({
      message: "Availability could not be calculated.",
      name: "AvailabilityCalculationError",
    });
  });
});
