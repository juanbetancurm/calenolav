import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const tenantId = "00000000-0000-4000-8000-000000000812";
const session = {
  email: "owner@example.com",
  memberships: [{ role: "owner" as const, tenantId }],
  userId: "00000000-0000-4000-8000-000000000811",
};

describe("ApiClient owner transport", () => {
  it("uses same-origin credentials for session creation, recovery, and revocation", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(jsonResponse({ email: session.email, userId: session.userId }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new ApiClient({ baseUrl: "/", fetchImplementation });

    await expect(client.getSession()).resolves.toEqual(session);
    await expect(client.signIn({
      email: "owner@example.com",
      password: "correct horse battery staple",
    })).resolves.toEqual({ email: session.email, userId: session.userId });
    await expect(client.signOut()).resolves.toBeUndefined();

    expect(fetchImplementation.mock.calls).toEqual([
      ["/auth/session", {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      }],
      ["/auth/sign-in", {
        body: JSON.stringify({
          email: "owner@example.com",
          password: "correct horse battery staple",
        }),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      }],
      ["/auth/sign-out", {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "POST",
      }],
    ]);
  });

  it("reads only the selected tenant's safe connection and policy resources", async () => {
    const connection = { connected: false as const, tenantId };
    const policy = {
      bookingWindowDays: 60,
      minimumNoticeMinutes: 120,
      slotDurationMinutes: 30,
      timeZone: "America/Bogota",
      windows: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: connection }))
      .mockResolvedValueOnce(jsonResponse({ data: { policy, tenantId } }));
    const client = new ApiClient({
      baseUrl: "https://api.calenolav.example/",
      fetchImplementation,
    });

    await expect(client.getGoogleConnectionStatus(tenantId)).resolves.toEqual(connection);
    await expect(client.getAvailabilityPolicy(tenantId)).resolves.toEqual({ policy, tenantId });
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      `https://api.calenolav.example/tenants/${tenantId}/google/connection`,
      `https://api.calenolav.example/tenants/${tenantId}/availability-policy`,
    ]);
    for (const [, request] of fetchImplementation.mock.calls) {
      expect(request).toMatchObject({ credentials: "include", method: "GET" });
    }
  });
});
