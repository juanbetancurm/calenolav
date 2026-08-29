import { describe, expect, it } from "vitest";
import {
  AvailabilityPolicyValidationError,
  normalizeAvailabilityPolicy,
} from "../src/availability/weekly-policy.js";

const validPolicy = {
  bookingWindowDays: 60,
  minimumNoticeMinutes: 120,
  slotDurationMinutes: 30,
  timeZone: "America/Bogota",
  windows: [
    { endMinute: 1020, startMinute: 780, weekday: 3 },
    { endMinute: 720, startMinute: 540, weekday: 1 },
    { endMinute: 1020, startMinute: 780, weekday: 1 },
  ],
};

describe("weekly availability policy", () => {
  it("normalizes the time zone and returns windows in canonical order", () => {
    const inputWindows = [...validPolicy.windows];

    expect(
      normalizeAvailabilityPolicy({
        ...validPolicy,
        timeZone: "  America/Bogota  ",
        windows: inputWindows,
      }),
    ).toEqual({
      ...validPolicy,
      windows: [
        { endMinute: 720, startMinute: 540, weekday: 1 },
        { endMinute: 1020, startMinute: 780, weekday: 1 },
        { endMinute: 1020, startMinute: 780, weekday: 3 },
      ],
    });
    expect(inputWindows).toEqual(validPolicy.windows);
  });

  it("allows an explicitly unavailable weekly schedule", () => {
    expect(
      normalizeAvailabilityPolicy({ ...validPolicy, windows: [] }),
    ).toMatchObject({ windows: [] });
  });

  it.each([
    ["slot duration", { slotDurationMinutes: 0 }],
    ["slot grid", { slotDurationMinutes: 7 }],
    ["minimum notice", { minimumNoticeMinutes: -1 }],
    ["minimum notice limit", { minimumNoticeMinutes: 43_205 }],
    ["booking horizon", { bookingWindowDays: 0 }],
    ["booking horizon limit", { bookingWindowDays: 366 }],
  ])("rejects invalid %s", (_label, override) => {
    expect(() =>
      normalizeAvailabilityPolicy({ ...validPolicy, ...override }),
    ).toThrow(AvailabilityPolicyValidationError);
  });

  it.each([
    "",
    "Not/A-Time-Zone",
  ])("rejects invalid IANA time zone %j", (timeZone) => {
    expect(() =>
      normalizeAvailabilityPolicy({ ...validPolicy, timeZone }),
    ).toThrow(AvailabilityPolicyValidationError);
  });

  it.each([
    { endMinute: 600, startMinute: 540, weekday: 0 },
    { endMinute: 600, startMinute: 540, weekday: 8 },
    { endMinute: 600, startMinute: -5, weekday: 1 },
    { endMinute: 1445, startMinute: 1380, weekday: 1 },
    { endMinute: 600, startMinute: 600, weekday: 1 },
    { endMinute: 602, startMinute: 540, weekday: 1 },
    { endMinute: 555, startMinute: 540, weekday: 1 },
  ])("rejects malformed weekly window %#", (window) => {
    expect(() =>
      normalizeAvailabilityPolicy({ ...validPolicy, windows: [window] }),
    ).toThrow(AvailabilityPolicyValidationError);
  });

  it("rejects overlaps while allowing adjacent windows", () => {
    expect(() =>
      normalizeAvailabilityPolicy({
        ...validPolicy,
        windows: [
          { endMinute: 720, startMinute: 540, weekday: 1 },
          { endMinute: 780, startMinute: 660, weekday: 1 },
        ],
      }),
    ).toThrow(AvailabilityPolicyValidationError);

    expect(
      normalizeAvailabilityPolicy({
        ...validPolicy,
        windows: [
          { endMinute: 720, startMinute: 540, weekday: 1 },
          { endMinute: 900, startMinute: 720, weekday: 1 },
        ],
      }).windows,
    ).toHaveLength(2);
  });
});
