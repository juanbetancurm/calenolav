import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarEventClient } from "../src/google/google-event-client.js";

const bookingId = "00000000-0000-4000-8000-000000000901";

describe("Google event recovery", () => {
  it("treats a deterministic duplicate event as already created", async () => {
    const request = vi.fn(async () => {
      throw { response: { status: 409 } };
    });
    const client = new GoogleCalendarEventClient({
      clientFactory: vi.fn(() => ({ request })),
      clientId: "google-client.apps.googleusercontent.com",
      clientSecret: "synthetic-client-secret",
    });

    await expect(
      client.createEvent({
        attendeeEmail: "visitor@example.com",
        bookingId,
        calendarId: "primary",
        endAt: new Date("2026-09-07T15:00:00.000Z"),
        refreshToken: "refresh-token",
        startAt: new Date("2026-09-07T14:30:00.000Z"),
      }),
    ).resolves.toEqual({ googleEventId: bookingId.replaceAll("-", "") });
  });
});
