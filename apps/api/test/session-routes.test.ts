import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InvalidCredentialsError,
  InvalidSessionError,
  type AuthenticateSessionService,
  type SignInService,
  type SignOutService,
} from "../src/auth/session-services.js";
import { registerSessionRoutes } from "../src/auth/session-routes.js";

const apps: ReturnType<typeof Fastify>[] = [];
const userId = "00000000-0000-4000-8000-000000000001";
const tenantId = "00000000-0000-4000-8000-000000000002";

function createApp(overrides: {
  authenticate?: AuthenticateSessionService["execute"];
  signIn?: SignInService["execute"];
  signOut?: SignOutService["execute"];
} = {}) {
  const app = Fastify({ logger: false });
  apps.push(app);
  const authenticate = overrides.authenticate ?? vi.fn(async () => {
    throw new InvalidSessionError();
  });
  const signIn = overrides.signIn ?? vi.fn(async () => {
    throw new InvalidCredentialsError();
  });
  const signOut = overrides.signOut ?? vi.fn(async () => undefined);

  void app.register(registerSessionRoutes, {
    authenticateSession: { execute: authenticate },
    secureCookies: true,
    signIn: { execute: signIn },
    signOut: { execute: signOut },
  });

  return { app, authenticate, signIn, signOut };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("session HTTP routes", () => {
  it("signs in with a generic response and sets a fresh hardened cookie", async () => {
    const signIn = vi.fn(async () => ({
      email: "owner@example.com",
      expiresAt: new Date("2026-09-11T14:00:00.000Z"),
      sessionToken: "fresh-session-token",
      userId,
    }));
    const { app } = createApp({ signIn });

    const response = await app.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: "owner@example.com", password: "correct horse battery staple" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: "owner@example.com", userId });
    expect(response.body).not.toContain("fresh-session-token");
    expect(response.headers["cache-control"]).toBe("no-store");
    const cookie = response.headers["set-cookie"];
    expect(cookie).toContain("calenolav_session=fresh-session-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("returns the same 401 body for invalid credentials", async () => {
    const { app } = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: "missing@example.com", password: "unknown password value" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "invalid_credentials" } });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("returns the tenant-aware principal for an authenticated cookie", async () => {
    const authenticate = vi.fn(async () => ({
      email: "owner@example.com",
      memberships: [{ role: "owner" as const, tenantId }],
      userId,
    }));
    const { app } = createApp({ authenticate });

    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
      cookies: { calenolav_session: "presented-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      email: "owner@example.com",
      memberships: [{ role: "owner", tenantId }],
      userId,
    });
    expect(authenticate).toHaveBeenCalledWith("presented-session-token");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns one 401 response for a missing or invalid session", async () => {
    const { app } = createApp();

    const response = await app.inject({ method: "GET", url: "/auth/session" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "invalid_session" } });
  });

  it("revokes server state, clears the cookie, and remains idempotent", async () => {
    const signOut = vi.fn(async () => undefined);
    const { app } = createApp({ signOut });

    const response = await app.inject({
      method: "POST",
      url: "/auth/sign-out",
      cookies: { calenolav_session: "session-to-revoke" },
    });

    expect(response.statusCode).toBe(204);
    expect(signOut).toHaveBeenCalledWith("session-to-revoke");
    expect(response.headers["set-cookie"]).toContain("calenolav_session=");
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["clear-site-data"]).toBe('"cache", "cookies", "storage"');
  });
});
