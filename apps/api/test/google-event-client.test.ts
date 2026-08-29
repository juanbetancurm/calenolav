import { describe, expect, it, vi } from "vitest";
import {
  GoogleCalendarEventClient,
  GoogleCalendarEventError,
} from "../src/google/google-event-client.js";

const bookingId = "00000000-0000-4000-8000-000000000702";
const startAt = new Date("2026-09-07T14:30:00.000Z");
const endAt = new Date("2026-09-07T15:00:00.000Z");

function createClient(
  response: { id?: string | null } = { id: bookingId.replaceAll("-", "") },
) {
  const request = vi.fn(async () => ({ data: response }));
  const clientFactory = vi.fn(
    (_options: {
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    }) => ({ request }),
  );
  const client = new GoogleCalendarEventClient({
    clientFactory,
    clientId: "google-client.apps.googleusercontent.com",
    clientSecret: "synthetic-client-secret",
  });
  return { client, clientFactory, request };
}

const command = {
  attendeeEmail: "visitor@example.com",
  bookingId,
  calendarId: "primary",
  endAt,
  refreshToken: "long-lived-refresh-token",
  startAt,
};

describe("GoogleCalendarEventClient", () => {
  it("creates one minimal deterministic event and invites the attendee", async () => {
    const { client, clientFactory, request } = createClient();

    await expect(client.createEvent(command)).resolves.toEqual({
      googleEventId: bookingId.replaceAll("-", ""),
    });
    expect(clientFactory).toHaveBeenCalledWith({
      clientId: "google-client.apps.googleusercontent.com",
      clientSecret: "synthetic-client-secret",
      refreshToken: "long-lived-refresh-token",
    });
    expect(request).toHaveBeenCalledWith({
      data: {
        attendees: [{ email: "visitor@example.com" }],
        end: { dateTime: "2026-09-07T15:00:00.000Z", timeZone: "UTC" },
        id: bookingId.replaceAll("-", ""),
        start: { dateTime: "2026-09-07T14:30:00.000Z", timeZone: "UTC" },
        summary: "Scheduled appointment",
      },
      method: "POST",
      params: { sendUpdates: "all" },
      url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    });
  });

  it("creates a fresh credential-isolated SDK client for every event", async () => {
    const { client, clientFactory } = createClient();
    await client.createEvent({ ...command, refreshToken: "tenant-one-token" });
    await client.createEvent({ ...command, refreshToken: "tenant-two-token" });

    expect(clientFactory.mock.calls.map(([options]) => options.refreshToken)).toEqual([
      "tenant-one-token",
      "tenant-two-token",
    ]);
  });

  it.each([
    ["blank calendar", { calendarId: "" }],
    ["blank attendee", { attendeeEmail: "" }],
    ["blank token", { refreshToken: "" }],
    ["invalid interval", { endAt: startAt }],
    ["invalid booking id", { bookingId: "not-a-uuid" }],
  ] as const)("rejects %s before SDK access", async (_label, override) => {
    const { client, clientFactory } = createClient();

    await expect(client.createEvent({ ...command, ...override })).rejects.toBeInstanceOf(
      GoogleCalendarEventError,
    );
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("hides missing event identifiers and provider failures", async () => {
    const missing = createClient({});
    await expect(missing.client.createEvent(command)).rejects.toBeInstanceOf(
      GoogleCalendarEventError,
    );

    const rejected = createClient();
    rejected.request.mockRejectedValueOnce(new Error("provider detail"));
    await expect(rejected.client.createEvent(command)).rejects.toBeInstanceOf(
      GoogleCalendarEventError,
    );
  });

  it.each([
    ["client ID", { clientId: "" }],
    ["client secret", { clientSecret: "" }],
  ] as const)("rejects blank %s during construction", (_label, override) => {
    expect(
      () =>
        new GoogleCalendarEventClient({
          clientFactory: vi.fn(() => ({ request: vi.fn() })),
          clientId: "google-client.apps.googleusercontent.com",
          clientSecret: "synthetic-client-secret",
          ...override,
        }),
    ).toThrow(Error);
  });

  it("exports one stable provider-safe error", () => {
    expect(new GoogleCalendarEventError()).toMatchObject({
      message: "Google Calendar event could not be created.",
      name: "GoogleCalendarEventError",
    });
  });
});
