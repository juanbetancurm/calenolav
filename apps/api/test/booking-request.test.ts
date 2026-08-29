import { describe, expect, it } from "vitest";
import {
  BookingRequestValidationError,
  normalizePublicBookingRequest,
} from "../src/booking/booking-request.js";

const validRequest = {
  attendeeEmail: " Visitor@Example.com ",
  attendeeName: "  Ada Lovelace  ",
  idempotencyKey: "110ec58a-a0f2-4ac4-8393-c866d813b8d1",
  startAt: "2026-09-07T14:30:00.000Z",
  tenantSlug: " Example-Tenant ",
};

describe("public booking request", () => {
  it("normalizes public identity and a canonical five-minute UTC start", () => {
    expect(normalizePublicBookingRequest(validRequest)).toEqual({
      attendeeEmail: "visitor@example.com",
      attendeeName: "Ada Lovelace",
      idempotencyKey: "110ec58a-a0f2-4ac4-8393-c866d813b8d1",
      startAt: new Date("2026-09-07T14:30:00.000Z"),
      tenantSlug: "example-tenant",
    });
  });

  it.each([
    ["", "tenantSlug"],
    ["Not_Safe", "tenantSlug"],
    ["-leading", "tenantSlug"],
    [`a${"b".repeat(63)}`, "tenantSlug"],
  ] as const)("rejects unsafe tenant slug %j", (tenantSlug, field) => {
    expect(() =>
      normalizePublicBookingRequest({ ...validRequest, tenantSlug }),
    ).toThrow(expect.objectContaining({ field }));
  });

  it.each(["", "missing-at", "a@b", `a@${"b".repeat(317)}.com`])(
    "rejects invalid attendee email %j",
    (attendeeEmail) => {
      expect(() =>
        normalizePublicBookingRequest({ ...validRequest, attendeeEmail }),
      ).toThrow(expect.objectContaining({ field: "attendeeEmail" }));
    },
  );

  it("accepts Unicode names but rejects blank, control, and oversized names", () => {
    expect(
      normalizePublicBookingRequest({
        ...validRequest,
        attendeeName: "  Mar\u00eda Jos\u00e9  ",
      }).attendeeName,
    ).toBe("Mar\u00eda Jos\u00e9");

    for (const attendeeName of ["   ", "Visitor\nInjected", "x".repeat(121)]) {
      expect(() =>
        normalizePublicBookingRequest({ ...validRequest, attendeeName }),
      ).toThrow(expect.objectContaining({ field: "attendeeName" }));
    }
  });

  it.each([
    "110ec58a-a0f2-1ac4-8393-c866d813b8d1",
    "110ec58a-a0f2-4ac4-7393-c866d813b8d1",
    "not-a-uuid",
    "",
  ])("requires a UUIDv4 idempotency key: %j", (idempotencyKey) => {
    expect(() =>
      normalizePublicBookingRequest({ ...validRequest, idempotencyKey }),
    ).toThrow(expect.objectContaining({ field: "idempotencyKey" }));
  });

  it.each([
    "invalid",
    "2026-09-07T14:30:00Z",
    "2026-09-07T09:30:00.000-05:00",
    "2026-09-07T14:32:00.000Z",
    "2026-09-07T14:30:01.000Z",
  ])("requires one canonical five-minute UTC start: %j", (startAt) => {
    expect(() =>
      normalizePublicBookingRequest({ ...validRequest, startAt }),
    ).toThrow(expect.objectContaining({ field: "startAt" }));
  });

  it("exports one stable privacy-safe validation error", () => {
    expect(new BookingRequestValidationError("startAt")).toMatchObject({
      field: "startAt",
      message: "Booking request is invalid.",
      name: "BookingRequestValidationError",
    });
  });
});
