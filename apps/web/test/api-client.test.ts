import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "../src/api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("ApiClient", () => {
  it("reads public availability with an encoded slug and privacy credentials", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({
        data: {
          slots: [
            {
              endAt: "2026-09-07T15:00:00.000Z",
              startAt: "2026-09-07T14:30:00.000Z",
            },
          ],
        },
      }),
    );
    const client = new ApiClient({
      baseUrl: "https://api.calenolav.example/",
      fetchImplementation,
    });

    await expect(client.getPublicAvailability("example-tenant")).resolves.toEqual({
      slots: [
        {
          endAt: "2026-09-07T15:00:00.000Z",
          startAt: "2026-09-07T14:30:00.000Z",
        },
      ],
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.calenolav.example/public/example-tenant/availability",
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      },
    );
  });

  it("creates one public booking without adding client-owned fields", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse(
        {
          data: {
            bookingId: "00000000-0000-4000-8000-000000000702",
            endAt: "2026-09-07T15:00:00.000Z",
            startAt: "2026-09-07T14:30:00.000Z",
            status: "confirmed",
          },
        },
        201,
      ),
    );
    const client = new ApiClient({ baseUrl: "/", fetchImplementation });
    const input = {
      attendeeEmail: "visitor@example.com",
      attendeeName: "Ada Lovelace",
      idempotencyKey: "110ec58a-a0f2-4ac4-8393-c866d813b8d1",
      startAt: "2026-09-07T14:30:00.000Z",
    };

    await expect(client.createPublicBooking("example-tenant", input)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/public/example-tenant/bookings",
      {
        body: JSON.stringify(input),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
  });

  it("maps structured and malformed failures to one safe client error", async () => {
    const structured = new ApiClient({
      baseUrl: "/",
      fetchImplementation: vi.fn(async () =>
        jsonResponse({ error: { code: "booking_conflict" } }, 409),
      ),
    });
    await expect(
      structured.getPublicAvailability("example-tenant"),
    ).rejects.toMatchObject({ code: "booking_conflict", status: 409 });

    const malformed = new ApiClient({
      baseUrl: "/",
      fetchImplementation: vi.fn(async () =>
        new Response("provider detail", { status: 503 }),
      ),
    });
    const rejection = malformed.getPublicAvailability("example-tenant");
    await expect(rejection).rejects.toBeInstanceOf(ApiClientError);
    await expect(rejection).rejects.toMatchObject({
      code: "request_failed",
      message: "The request could not be completed.",
      status: 503,
    });
  });
});
