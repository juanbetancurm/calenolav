import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
const userId = "00000000-0000-4000-8000-000000000001";
const tenantId = "00000000-0000-4000-8000-000000000002";

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("Google OAuth app-factory wiring", () => {
  it("registers authorization start and callback when dependencies are supplied", async () => {
    const principal = {
      email: "owner@example.com",
      memberships: [{ role: "owner" as const, tenantId }],
      userId,
    };
    const authenticateSession = vi.fn(async () => principal);
    const beginGoogleOAuth = vi.fn(async () => ({
      authorizationUrl:
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&state=opaque",
    }));
    const completeGoogleOAuth = vi.fn(async () => ({ tenantId }));
    const app = buildApp({
      googleOAuth: {
        authenticateSession: { execute: authenticateSession },
        beginGoogleOAuth: { execute: beginGoogleOAuth },
        completeGoogleOAuth: { execute: completeGoogleOAuth },
      },
      logger: false,
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const startResponse = await app.inject({
      method: "POST",
      url: `/tenants/${tenantId}/google/oauth/start`,
      cookies: { calenolav_session: "presented-session-token" },
    });

    expect(startResponse.statusCode).toBe(303);
    expect(authenticateSession).toHaveBeenCalledWith("presented-session-token");
    expect(beginGoogleOAuth).toHaveBeenCalledWith({ principal, tenantId });

    const callbackResponse = await app.inject({
      method: "GET",
      url: "/google/oauth/callback?code=authorization-code&state=opaque-state",
    });

    expect(callbackResponse.statusCode).toBe(200);
    expect(completeGoogleOAuth).toHaveBeenCalledWith({
      code: "authorization-code",
      state: "opaque-state",
    });
  });

  it("does not expose OAuth routes when Google OAuth is disabled", async () => {
    const app = buildApp({
      logger: false,
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const startResponse = await app.inject({
      method: "POST",
      url: `/tenants/${tenantId}/google/oauth/start`,
      cookies: { calenolav_session: "presented-session-token" },
    });
    const callbackResponse = await app.inject({
      method: "GET",
      url: "/google/oauth/callback?code=authorization-code&state=opaque-state",
    });

    expect(startResponse.statusCode).toBe(404);
    expect(callbackResponse.statusCode).toBe(404);
  });
});
