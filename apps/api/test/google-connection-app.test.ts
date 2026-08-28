import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
const tenantId = "00000000-0000-4000-8000-000000000401";
const principal = {
  email: "owner@example.com",
  memberships: [{ role: "owner" as const, tenantId }],
  userId: "00000000-0000-4000-8000-000000000402",
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("Google connection-management app-factory wiring", () => {
  it("registers authenticated status and disconnect routes when dependencies are supplied", async () => {
    const authenticateSession = vi.fn(async () => principal);
    const getConnectionStatus = vi.fn(async () => ({
      connected: false as const,
      tenantId,
    }));
    const disconnectGoogleCalendar = vi.fn(async () => undefined);
    const app = buildApp({
      googleConnectionManagement: {
        authenticateSession: { execute: authenticateSession },
        disconnectGoogleCalendar: { execute: disconnectGoogleCalendar },
        getConnectionStatus: { execute: getConnectionStatus },
      },
      logger: false,
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const statusResponse = await app.inject({
      method: "GET",
      url: `/tenants/${tenantId}/google/connection`,
      cookies: { calenolav_session: "presented-session-token" },
    });
    const disconnectResponse = await app.inject({
      method: "DELETE",
      url: `/tenants/${tenantId}/google/connection`,
      cookies: { calenolav_session: "presented-session-token" },
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({
      data: { connected: false, tenantId },
    });
    expect(disconnectResponse.statusCode).toBe(204);
    expect(authenticateSession).toHaveBeenCalledTimes(2);
    expect(getConnectionStatus).toHaveBeenCalledWith({ principal, tenantId });
    expect(disconnectGoogleCalendar).toHaveBeenCalledWith({ principal, tenantId });
  });

  it("does not expose connection-management routes when dependencies are omitted", async () => {
    const app = buildApp({
      logger: false,
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const responses = await Promise.all([
      app.inject({
        method: "GET",
        url: `/tenants/${tenantId}/google/connection`,
      }),
      app.inject({
        method: "DELETE",
        url: `/tenants/${tenantId}/google/connection`,
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
    }
  });
});
