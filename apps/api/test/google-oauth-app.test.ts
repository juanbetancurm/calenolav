import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
const userId = "00000000-0000-4000-8000-000000000001";
const tenantId = "00000000-0000-4000-8000-000000000002";

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("Google OAuth app-factory wiring", () => {
  it("registers the authenticated redirect route when dependencies are supplied", async () => {
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
    const app = buildApp({
      googleOAuth: {
        authenticateSession: { execute: authenticateSession },
        beginGoogleOAuth: { execute: beginGoogleOAuth },
      },
      logger: false,
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/tenants/${tenantId}/google/oauth/start`,
      cookies: { calenolav_session: "presented-session-token" },
    });

    expect(response.statusCode).toBe(303);
    expect(authenticateSession).toHaveBeenCalledWith("presented-session-token");
    expect(beginGoogleOAuth).toHaveBeenCalledWith({ principal, tenantId });
  });

  it("does not expose the redirect route when Google OAuth is disabled", async () => {
    const app = buildApp({
      logger: false,
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/tenants/${tenantId}/google/oauth/start`,
      cookies: { calenolav_session: "presented-session-token" },
    });

    expect(response.statusCode).toBe(404);
  });
});
