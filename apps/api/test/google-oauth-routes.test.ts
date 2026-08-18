import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationError,
  InvalidSessionError,
  type AuthenticateSessionService,
} from "../src/auth/session-services.js";
import type { BeginGoogleOAuthService } from "../src/google/oauth-authorization.js";
import { registerGoogleOAuthRoutes } from "../src/google/oauth-routes.js";

const apps: ReturnType<typeof Fastify>[] = [];
const userId = "00000000-0000-4000-8000-000000000001";
const tenantId = "00000000-0000-4000-8000-000000000002";
const googleAuthorizationUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&state=opaque";

function createApp(overrides: {
  authenticate?: AuthenticateSessionService["execute"];
  beginGoogleOAuth?: BeginGoogleOAuthService["execute"];
} = {}) {
  const app = Fastify({ logger: false });
  apps.push(app);
  const authenticate = overrides.authenticate ?? vi.fn(async () => {
    throw new InvalidSessionError();
  });
  const beginGoogleOAuth = overrides.beginGoogleOAuth ?? vi.fn(async () => ({
    authorizationUrl: googleAuthorizationUrl,
  }));

  void app.register(registerGoogleOAuthRoutes, {
    authenticateSession: { execute: authenticate },
    beginGoogleOAuth: { execute: beginGoogleOAuth },
  });

  return { app, authenticate, beginGoogleOAuth };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("POST /tenants/:tenantId/google/oauth/start", () => {
  it("authenticates the owner, creates an attempt, and redirects to Google", async () => {
    const principal = {
      email: "owner@example.com",
      memberships: [{ role: "owner" as const, tenantId }],
      userId,
    };
    const authenticate = vi.fn(async () => principal);
    const { app, beginGoogleOAuth } = createApp({ authenticate });

    const response = await app.inject({
      method: "POST",
      url: `/tenants/${tenantId}/google/oauth/start`,
      cookies: { calenolav_session: "presented-session-token" },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(googleAuthorizationUrl);
    expect(response.body).toBe("");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(authenticate).toHaveBeenCalledWith("presented-session-token");
    expect(beginGoogleOAuth).toHaveBeenCalledWith({ principal, tenantId });
  });

  it("returns 401 without consulting services when the session cookie is missing", async () => {
    const { app, authenticate, beginGoogleOAuth } = createApp();

    const response = await app.inject({
      method: "POST",
      url: `/tenants/${tenantId}/google/oauth/start`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "invalid_session" } });
    expect(authenticate).not.toHaveBeenCalled();
    expect(beginGoogleOAuth).not.toHaveBeenCalled();
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns the same 401 when the presented session is invalid", async () => {
    const authenticate = vi.fn(async () => {
      throw new InvalidSessionError();
    });
    const { app, beginGoogleOAuth } = createApp({ authenticate });

    const response = await app.inject({
      method: "POST",
      url: `/tenants/${tenantId}/google/oauth/start`,
      cookies: { calenolav_session: "invalid-session-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "invalid_session" } });
    expect(beginGoogleOAuth).not.toHaveBeenCalled();
  });

  it("returns 403 without redirecting when the principal is not a tenant owner", async () => {
    const authenticate = vi.fn(async () => ({
      email: "member@example.com",
      memberships: [{ role: "member" as const, tenantId }],
      userId,
    }));
    const beginGoogleOAuth = vi.fn(async () => {
      throw new AuthorizationError();
    });
    const { app } = createApp({ authenticate, beginGoogleOAuth });

    const response = await app.inject({
      method: "POST",
      url: `/tenants/${tenantId}/google/oauth/start`,
      cookies: { calenolav_session: "member-session-token" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "forbidden" } });
    expect(response.headers.location).toBeUndefined();
  });

  it("rejects a malformed tenant id before authenticating or creating an attempt", async () => {
    const { app, authenticate, beginGoogleOAuth } = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/tenants/not-a-uuid/google/oauth/start",
      cookies: { calenolav_session: "presented-session-token" },
    });

    expect(response.statusCode).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(beginGoogleOAuth).not.toHaveBeenCalled();
  });
});
