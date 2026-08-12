import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RegistrationConflictError,
  RegistrationValidationError,
  type RegisterOwnerService,
} from "../src/auth/register-owner.js";
import { registerRegistrationRoutes } from "../src/auth/registration-routes.js";

const apps: ReturnType<typeof Fastify>[] = [];

function createApp(execute: RegisterOwnerService["execute"]) {
  const app = Fastify({ logger: false });
  apps.push(app);
  void app.register(registerRegistrationRoutes, {
    registerOwner: { execute },
    secureCookies: true,
  });
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("POST /auth/register", () => {
  it("creates an owner and moves the raw token into a hardened cookie", async () => {
    const execute = vi.fn(async () => ({
      email: "owner@example.com",
      expiresAt: new Date("2026-09-11T12:00:00.000Z"),
      sessionToken: "raw-token-must-not-enter-json",
      tenantId: "00000000-0000-4000-8000-000000000002",
      userId: "00000000-0000-4000-8000-000000000001",
    }));
    const app = createApp(execute);

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "owner@example.com",
        locale: "es",
        name: "Example Owner",
        password: "correct horse battery staple",
        slug: "example-owner",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      email: "owner@example.com",
      tenantId: "00000000-0000-4000-8000-000000000002",
      userId: "00000000-0000-4000-8000-000000000001",
    });
    expect(response.body).not.toContain("raw-token-must-not-enter-json");
    const cookie = response.headers["set-cookie"];
    expect(cookie).toContain("calenolav_session=raw-token-must-not-enter-json");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("returns a field-specific validation response without setting a cookie", async () => {
    const execute = vi.fn(async () => {
      throw new RegistrationValidationError("password", "Password is invalid.");
    });
    const app = createApp(execute);

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "owner@example.com",
        locale: "es",
        name: "Example Owner",
        password: "too short",
        slug: "example-owner",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "invalid_registration", field: "password" },
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("uses one generic conflict response for duplicate private or public identity", async () => {
    const execute = vi.fn(async () => {
      throw new RegistrationConflictError();
    });
    const app = createApp(execute);

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "owner@example.com",
        locale: "es",
        name: "Example Owner",
        password: "correct horse battery staple",
        slug: "example-owner",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: "registration_conflict" } });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
});
