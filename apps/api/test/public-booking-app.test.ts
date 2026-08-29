import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { CreateBookingService } from "../src/booking/create-booking-service.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("public booking app-factory wiring", () => {
  it("registers the public booking route when its dependency is supplied", async () => {
    const createBooking = vi.fn<CreateBookingService["execute"]>(async () => ({
      bookingId: "00000000-0000-4000-8000-000000000702",
      endAt: new Date("2026-09-07T15:00:00.000Z"),
      startAt: new Date("2026-09-07T14:30:00.000Z"),
      status: "confirmed",
    }));
    const app = buildApp({
      publicBooking: { createBooking: { execute: createBooking } },
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: {
        attendeeEmail: "visitor@example.com",
        attendeeName: "Ada Lovelace",
        idempotencyKey: "110ec58a-a0f2-4ac4-8393-c866d813b8d1",
        startAt: "2026-09-07T14:30:00.000Z",
      },
      url: "/public/example-tenant/bookings",
    });

    expect(response.statusCode).toBe(201);
  });

  it("does not expose the public booking route when dependencies are omitted", async () => {
    const app = buildApp({ readinessCheck: async () => undefined });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: {},
      url: "/public/example-tenant/bookings",
    });

    expect(response.statusCode).toBe(404);
  });
});
