import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationError,
  InvalidSessionError,
  type AuthenticatedPrincipal,
} from "../src/auth/session-services.js";
import type {
  GetTenantAvailabilityPolicyService,
  ReplaceTenantAvailabilityPolicyService,
} from "../src/availability/policy-services.js";
import { registerAvailabilityPolicyRoutes } from "../src/availability/policy-routes.js";
import { AvailabilityPolicyValidationError } from "../src/availability/weekly-policy.js";

const apps: ReturnType<typeof Fastify>[] = [];
const tenantId = "00000000-0000-4000-8000-000000000411";
const principal: AuthenticatedPrincipal = {
  email: "owner@example.com",
  memberships: [{ role: "owner", tenantId }],
  userId: "00000000-0000-4000-8000-000000000412",
};
const policy = {
  bookingWindowDays: 60,
  minimumNoticeMinutes: 120,
  slotDurationMinutes: 30,
  timeZone: "America/Bogota",
  windows: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
};

function createApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  const authenticateSession = vi.fn(async () => principal);
  const getPolicy = vi.fn<GetTenantAvailabilityPolicyService["execute"]>(
    async () => ({ policy, tenantId }),
  );
  const replacePolicy = vi.fn<ReplaceTenantAvailabilityPolicyService["execute"]>(
    async () => ({ policy, tenantId }),
  );
  void app.register(registerAvailabilityPolicyRoutes, {
    authenticateSession: { execute: authenticateSession },
    getPolicy: { execute: getPolicy },
    replacePolicy: { execute: replacePolicy },
  });
  return { app, authenticateSession, getPolicy, replacePolicy };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function expectPrivacyHeaders(headers: Record<string, unknown>): void {
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
}

describe("tenant availability policy routes", () => {
  it("returns the authenticated owner's policy", async () => {
    const { app, authenticateSession, getPolicy } = createApp();
    const response = await app.inject({
      headers: { cookie: "calenolav_session=presented-session-token" },
      method: "GET",
      url: `/tenants/${tenantId}/availability-policy`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { policy, tenantId } });
    expect(authenticateSession).toHaveBeenCalledWith("presented-session-token");
    expect(getPolicy).toHaveBeenCalledWith({ principal, tenantId });
    expectPrivacyHeaders(response.headers);
  });

  it("validates and replaces the authenticated owner's complete policy", async () => {
    const { app, replacePolicy } = createApp();
    const response = await app.inject({
      headers: { cookie: "calenolav_session=presented-session-token" },
      method: "PUT",
      payload: policy,
      url: `/tenants/${tenantId}/availability-policy`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { policy, tenantId } });
    expect(replacePolicy).toHaveBeenCalledWith({ policy, principal, tenantId });
    expectPrivacyHeaders(response.headers);
  });

  it("maps application policy validation to one safe 400 response", async () => {
    const { app, replacePolicy } = createApp();
    replacePolicy.mockRejectedValueOnce(new AvailabilityPolicyValidationError());
    const response = await app.inject({
      headers: { cookie: "calenolav_session=presented-session-token" },
      method: "PUT",
      payload: policy,
      url: `/tenants/${tenantId}/availability-policy`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "invalid_availability_policy" },
    });
    expectPrivacyHeaders(response.headers);
  });

  it("uses consistent 401 and 403 responses", async () => {
    const missing = createApp();
    const invalid = createApp();
    invalid.authenticateSession.mockRejectedValueOnce(new InvalidSessionError());
    const forbidden = createApp();
    forbidden.getPolicy.mockRejectedValueOnce(new AuthorizationError());

    const responses = await Promise.all([
      missing.app.inject({ method: "GET", url: `/tenants/${tenantId}/availability-policy` }),
      invalid.app.inject({
        headers: { cookie: "calenolav_session=invalid" },
        method: "GET",
        url: `/tenants/${tenantId}/availability-policy`,
      }),
      forbidden.app.inject({
        headers: { cookie: "calenolav_session=presented" },
        method: "GET",
        url: `/tenants/${tenantId}/availability-policy`,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 403]);
    expect(responses[0]?.json()).toEqual({ error: { code: "invalid_session" } });
    expect(responses[1]?.json()).toEqual({ error: { code: "invalid_session" } });
    expect(responses[2]?.json()).toEqual({ error: { code: "forbidden" } });
    responses.forEach((response) => expectPrivacyHeaders(response.headers));
  });

  it("rejects malformed tenant IDs and bodies before authentication", async () => {
    const { app, authenticateSession } = createApp();
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/tenants/not-a-uuid/availability-policy" }),
      app.inject({
        method: "PUT",
        payload: { ...policy, unexpected: true },
        url: `/tenants/${tenantId}/availability-policy`,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400]);
    expect(authenticateSession).not.toHaveBeenCalled();
  });
});
