import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublicAvailabilityNotFoundError,
  PublicAvailabilityUnavailableError,
  type GetPublicAvailabilityService,
} from "../src/availability/public-availability-service.js";
import { registerPublicAvailabilityRoutes } from "../src/availability/public-availability-route.js";

const apps: ReturnType<typeof Fastify>[] = [];

function createApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  const getAvailability = vi.fn<GetPublicAvailabilityService["execute"]>(
    async () => ({
      slots: [
        {
          endAt: new Date("2026-09-07T15:00:00.000Z"),
          startAt: new Date("2026-09-07T14:30:00.000Z"),
        },
      ],
    }),
  );
  void app.register(registerPublicAvailabilityRoutes, {
    getAvailability: { execute: getAvailability },
  });
  return { app, getAvailability };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function expectPrivacyHeaders(headers: Record<string, unknown>): void {
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
}

describe("GET /public/:slug/availability", () => {
  it("returns only serialized UTC candidate timestamps without a session", async () => {
    const { app, getAvailability } = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/public/example-tenant/availability",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        slots: [
          {
            endAt: "2026-09-07T15:00:00.000Z",
            startAt: "2026-09-07T14:30:00.000Z",
          },
        ],
      },
    });
    expect(getAvailability).toHaveBeenCalledWith({ slug: "example-tenant" });
    expectPrivacyHeaders(response.headers);
  });

  it.each([
    [404, new PublicAvailabilityNotFoundError(), "availability_not_found"],
    [
      503,
      new PublicAvailabilityUnavailableError(),
      "availability_unavailable",
    ],
  ] as const)("maps expected failure to safe %i", async (status, error, code) => {
    const { app, getAvailability } = createApp();
    getAvailability.mockRejectedValueOnce(error);

    const response = await app.inject({
      method: "GET",
      url: "/public/example-tenant/availability",
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: { code } });
    expect(response.body).not.toContain(error.message);
    expectPrivacyHeaders(response.headers);
  });

  it("rejects malformed slugs before application access", async () => {
    const { app, getAvailability } = createApp();

    const response = await app.inject({
      method: "GET",
      url: "/public/Not_Safe/availability",
    });

    expect(response.statusCode).toBe(400);
    expect(getAvailability).not.toHaveBeenCalled();
  });
});
