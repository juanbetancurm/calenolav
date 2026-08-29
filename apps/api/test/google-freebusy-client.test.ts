import { describe, expect, it, vi } from "vitest";
import {
  GoogleCalendarFreeBusyClient,
  GoogleCalendarFreeBusyError,
} from "../src/google/google-freebusy-client.js";

const startAt = new Date("2026-09-07T14:10:00.000Z");
const endAt = new Date("2026-09-08T12:10:00.000Z");

function createClient(response?: unknown) {
  const request = vi.fn(async () => ({
    data:
      response ??
      {
        calendars: {
          primary: {
            busy: [
              {
                end: "2026-09-07T15:45:00.000Z",
                start: "2026-09-07T15:15:00.000Z",
              },
            ],
          },
        },
      },
  }));
  const clientFactory = vi.fn(
    (_options: {
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    }) => ({ request }),
  );
  const client = new GoogleCalendarFreeBusyClient({
    clientFactory,
    clientId: "google-client.apps.googleusercontent.com",
    clientSecret: "synthetic-client-secret",
  });
  return { client, clientFactory, request };
}

describe("GoogleCalendarFreeBusyClient", () => {
  it("uses one isolated authorized client and requests only opaque busy ranges", async () => {
    const { client, clientFactory, request } = createClient();

    const result = await client.queryBusyIntervals({
      calendarId: "primary",
      endAt,
      refreshToken: "long-lived-refresh-token",
      startAt,
    });

    expect(clientFactory).toHaveBeenCalledWith({
      clientId: "google-client.apps.googleusercontent.com",
      clientSecret: "synthetic-client-secret",
      refreshToken: "long-lived-refresh-token",
    });
    expect(request).toHaveBeenCalledWith({
      data: {
        items: [{ id: "primary" }],
        timeMax: "2026-09-08T12:10:00.000Z",
        timeMin: "2026-09-07T14:10:00.000Z",
        timeZone: "UTC",
      },
      method: "POST",
      url: "https://www.googleapis.com/calendar/v3/freeBusy",
    });
    expect(result).toEqual([
      {
        endAt: new Date("2026-09-07T15:45:00.000Z"),
        startAt: new Date("2026-09-07T15:15:00.000Z"),
      },
    ]);
  });

  it("creates a fresh credential-isolated SDK client for every query", async () => {
    const { client, clientFactory } = createClient();

    await client.queryBusyIntervals({
      calendarId: "primary",
      endAt,
      refreshToken: "tenant-one-token",
      startAt,
    });
    await client.queryBusyIntervals({
      calendarId: "primary",
      endAt,
      refreshToken: "tenant-two-token",
      startAt,
    });

    expect(clientFactory).toHaveBeenCalledTimes(2);
    expect(clientFactory.mock.calls.map(([options]) => options.refreshToken)).toEqual([
      "tenant-one-token",
      "tenant-two-token",
    ]);
  });

  it.each([
    ["missing calendar", { calendars: {} }],
    ["calendar error", { calendars: { primary: { busy: [], errors: [{}] } } }],
    [
      "malformed interval",
      {
        calendars: {
          primary: { busy: [{ end: "invalid", start: "also-invalid" }] },
        },
      },
    ],
  ] as const)("hides %s response details", async (_label, response) => {
    const { client } = createClient(response);

    await expect(
      client.queryBusyIntervals({
        calendarId: "primary",
        endAt,
        refreshToken: "long-lived-refresh-token",
        startAt,
      }),
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  it("hides SDK and transport failures", async () => {
    const { client, request } = createClient();
    request.mockRejectedValueOnce(new Error("certificate or provider detail"));

    await expect(
      client.queryBusyIntervals({
        calendarId: "primary",
        endAt,
        refreshToken: "long-lived-refresh-token",
        startAt,
      }),
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  it.each([
    ["client ID", { clientId: "" }],
    ["client secret", { clientSecret: "" }],
  ] as const)("rejects blank %s before client creation", (_label, override) => {
    expect(
      () =>
        new GoogleCalendarFreeBusyClient({
          clientFactory: vi.fn(() => ({ request: vi.fn() })),
          clientId: "google-client.apps.googleusercontent.com",
          clientSecret: "synthetic-client-secret",
          ...override,
        }),
    ).toThrow(Error);
  });

  it("exports one stable secret-safe provider error", () => {
    expect(new GoogleCalendarFreeBusyError()).toMatchObject({
      message: "Google Calendar availability could not be read.",
      name: "GoogleCalendarFreeBusyError",
    });
  });
});
