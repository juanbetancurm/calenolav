import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BookingConflictError,
  BookingNotFoundError,
  BookingUnavailableError,
  type CreateBookingService,
} from "../src/booking/create-booking-service.js";
import { BookingRequestValidationError } from "../src/booking/booking-request.js";
import { registerPublicBookingRoutes } from "../src/booking/public-booking-route.js";

const apps: ReturnType<typeof Fastify>[] = [];
const requestBody = {
  attendeeEmail: "visitor@example.com",
  attendeeName: "Ada Lovelace",
  idempotencyKey: "110ec58a-a0f2-4ac4-8393-c866d813b8d1",
  startAt: "2026-09-07T14:30:00.000Z",
};

function createApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  const createBooking = vi.fn<CreateBookingService["execute"]>(async () => ({
    bookingId: "00000000-0000-4000-8000-000000000702",
    endAt: new Date("2026-09-07T15:00:00.000Z"),
    startAt: new Date("2026-09-07T14:30:00.000Z"),
    status: "confirmed",
  }));
  void app.register(registerPublicBookingRoutes, {
    createBooking: { execute: createBooking },
  });
  return { app, createBooking };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function expectPrivacyHeaders(headers: Record<string, unknown>): void {
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
}

describe("POST /public/:slug/bookings", () => {
  it("creates a booking without a session and returns only safe state", async () => {
    const { app, createBooking } = createApp();
    const response = await app.inject({
      method: "POST",
      payload: requestBody,
      url: "/public/example-tenant/bookings",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      data: {
        bookingId: "00000000-0000-4000-8000-000000000702",
        endAt: "2026-09-07T15:00:00.000Z",
        startAt: "2026-09-07T14:30:00.000Z",
        status: "confirmed",
      },
    });
    expect(createBooking).toHaveBeenCalledWith({
      ...requestBody,
      tenantSlug: "example-tenant",
    });
    expectPrivacyHeaders(response.headers);
  });

  it.each([
    [400, new BookingRequestValidationError("attendeeEmail"), "invalid_booking_request"],
    [404, new BookingNotFoundError(), "booking_not_found"],
    [409, new BookingConflictError(), "booking_conflict"],
    [503, new BookingUnavailableError(), "booking_unavailable"],
  ] as const)("maps an expected failure to safe %i", async (status, error, code) => {
    const { app, createBooking } = createApp();
    createBooking.mockRejectedValueOnce(error);

    const response = await app.inject({
      method: "POST",
      payload: requestBody,
      url: "/public/example-tenant/bookings",
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: { code } });
    expect(response.body).not.toContain(error.message);
    expectPrivacyHeaders(response.headers);
  });

  it("rejects malformed slugs and bodies before application access", async () => {
    const { app, createBooking } = createApp();
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        payload: requestBody,
        url: "/public/Not_Safe/bookings",
      }),
      app.inject({
        method: "POST",
        payload: { ...requestBody, extra: "not-accepted" },
        url: "/public/example-tenant/bookings",
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400]);
    expect(createBooking).not.toHaveBeenCalled();
  });
});
