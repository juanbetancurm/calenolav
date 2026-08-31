import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const tenantId = "00000000-0000-4000-8000-000000000812";
const policy = {
  bookingWindowDays: 90,
  minimumNoticeMinutes: 180,
  slotDurationMinutes: 45,
  timeZone: "America/New_York",
  windows: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
};

describe("ApiClient owner management transport", () => {
  it("builds OAuth entry locally and performs an empty local disconnect", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }),
    );
    const client = new ApiClient({
      baseUrl: "https://api.calenolav.example/",
      fetchImplementation,
    });

    expect(client.getGoogleAuthorizationUrl(tenantId)).toBe(
      `https://api.calenolav.example/tenants/${tenantId}/google/oauth/start`,
    );
    await expect(client.disconnectGoogleCalendar(tenantId)).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledWith(
      `https://api.calenolav.example/tenants/${tenantId}/google/connection`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
  });

  it("replaces one complete tenant policy without adding browser-owned fields", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({ data: { policy, tenantId } }),
    );
    const client = new ApiClient({ baseUrl: "/", fetchImplementation });

    await expect(client.replaceAvailabilityPolicy(tenantId, policy)).resolves.toEqual({
      policy,
      tenantId,
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/tenants/${tenantId}/availability-policy`,
      {
        body: JSON.stringify(policy),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PUT",
      },
    );
  });
});
