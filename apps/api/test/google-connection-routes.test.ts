import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationError,
  InvalidSessionError,
  type AuthenticatedPrincipal,
} from "../src/auth/session-services.js";
import type {
  DisconnectGoogleCalendarService,
  GetGoogleCalendarConnectionStatusService,
} from "../src/google/connection-services.js";
import { registerGoogleConnectionRoutes } from "../src/google/connection-routes.js";

const apps: ReturnType<typeof Fastify>[] = [];
const tenantId = "00000000-0000-4000-8000-000000000301";
const principal: AuthenticatedPrincipal = {
  email: "owner@example.com",
  memberships: [{ role: "owner", tenantId }],
  userId: "00000000-0000-4000-8000-000000000302",
};

function createApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  const authenticateSession = vi.fn(async () => principal);
  const getConnectionStatus = vi.fn<
    GetGoogleCalendarConnectionStatusService["execute"]
  >(async () => ({
    calendarId: "primary",
    connected: true,
    connectedAt: new Date("2026-08-20T12:00:00.000Z"),
    googleAccountEmail: "calendar-owner@example.com",
    grantedScopes: ["scope-a", "scope-b"],
    tenantId,
    updatedAt: new Date("2026-08-20T13:00:00.000Z"),
  }));
  const disconnectGoogleCalendar = vi.fn<
    DisconnectGoogleCalendarService["execute"]
  >(async () => undefined);

  void app.register(registerGoogleConnectionRoutes, {
    authenticateSession: { execute: authenticateSession },
    disconnectGoogleCalendar: { execute: disconnectGoogleCalendar },
    getConnectionStatus: { execute: getConnectionStatus },
  });

  return {
    app,
    authenticateSession,
    disconnectGoogleCalendar,
    getConnectionStatus,
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function expectPrivacyHeaders(headers: Record<string, unknown>): void {
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
}

describe("Google connection management routes", () => {
  it("returns safe connected status for an authenticated tenant owner", async () => {
    const { app, authenticateSession, getConnectionStatus } = createApp();

    const response = await app.inject({
      headers: { cookie: "calenolav_session=presented-session-token" },
      method: "GET",
      url: `/tenants/${tenantId}/google/connection`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        calendarId: "primary",
        connected: true,
        connectedAt: "2026-08-20T12:00:00.000Z",
        googleAccountEmail: "calendar-owner@example.com",
        grantedScopes: ["scope-a", "scope-b"],
        tenantId,
        updatedAt: "2026-08-20T13:00:00.000Z",
      },
    });
    expect(response.body).not.toContain("ciphertext");
    expect(response.body).not.toContain("refreshToken");
    expect(authenticateSession).toHaveBeenCalledWith("presented-session-token");
    expect(getConnectionStatus).toHaveBeenCalledWith({ principal, tenantId });
    expectPrivacyHeaders(response.headers);
  });

  it("returns an explicit disconnected status", async () => {
    const { app, getConnectionStatus } = createApp();
    getConnectionStatus.mockResolvedValueOnce({ connected: false, tenantId });

    const response = await app.inject({
      headers: { cookie: "calenolav_session=presented-session-token" },
      method: "GET",
      url: `/tenants/${tenantId}/google/connection`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { connected: false, tenantId },
    });
    expectPrivacyHeaders(response.headers);
  });

  it("disconnects the selected tenant and returns an empty repeatable response", async () => {
    const { app, disconnectGoogleCalendar } = createApp();

    const response = await app.inject({
      headers: { cookie: "calenolav_session=presented-session-token" },
      method: "DELETE",
      url: `/tenants/${tenantId}/google/connection`,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(disconnectGoogleCalendar).toHaveBeenCalledWith({ principal, tenantId });
    expectPrivacyHeaders(response.headers);
  });

  it("uses one 401 response for missing and invalid sessions", async () => {
    const missing = createApp();
    const invalid = createApp();
    invalid.authenticateSession.mockRejectedValueOnce(new InvalidSessionError());

    const missingResponse = await missing.app.inject({
      method: "GET",
      url: `/tenants/${tenantId}/google/connection`,
    });
    const invalidResponse = await invalid.app.inject({
      headers: { cookie: "calenolav_session=invalid-session-token" },
      method: "GET",
      url: `/tenants/${tenantId}/google/connection`,
    });

    for (const response of [missingResponse, invalidResponse]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: { code: "invalid_session" } });
      expectPrivacyHeaders(response.headers);
    }
    expect(missing.authenticateSession).not.toHaveBeenCalled();
    expect(missing.getConnectionStatus).not.toHaveBeenCalled();
    expect(invalid.getConnectionStatus).not.toHaveBeenCalled();
  });

  it("maps tenant authorization failures to 403 for reads and deletes", async () => {
    const read = createApp();
    const remove = createApp();
    read.getConnectionStatus.mockRejectedValueOnce(new AuthorizationError());
    remove.disconnectGoogleCalendar.mockRejectedValueOnce(new AuthorizationError());

    const readResponse = await read.app.inject({
      headers: { cookie: "calenolav_session=presented-session-token" },
      method: "GET",
      url: `/tenants/${tenantId}/google/connection`,
    });
    const deleteResponse = await remove.app.inject({
      headers: { cookie: "calenolav_session=presented-session-token" },
      method: "DELETE",
      url: `/tenants/${tenantId}/google/connection`,
    });

    for (const response of [readResponse, deleteResponse]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: { code: "forbidden" } });
      expectPrivacyHeaders(response.headers);
    }
  });

  it("rejects malformed tenant identifiers before authentication", async () => {
    const { app, authenticateSession } = createApp();

    const responses = await Promise.all([
      app.inject({
        headers: { cookie: "calenolav_session=presented-session-token" },
        method: "GET",
        url: "/tenants/not-a-uuid/google/connection",
      }),
      app.inject({
        headers: { cookie: "calenolav_session=presented-session-token" },
        method: "DELETE",
        url: "/tenants/not-a-uuid/google/connection",
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(400);
    }
    expect(authenticateSession).not.toHaveBeenCalled();
  });
});
