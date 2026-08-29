import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { GetPublicAvailabilityService } from "../src/availability/public-availability-service.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("public availability app-factory wiring", () => {
  it("registers the public read route when its dependency is supplied", async () => {
    const getAvailability = vi.fn<GetPublicAvailabilityService["execute"]>(
      async () => ({ slots: [] }),
    );
    const app = buildApp({
      publicAvailability: { getAvailability: { execute: getAvailability } },
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/public/example-tenant/availability",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { slots: [] } });
  });

  it("does not expose the public route when dependencies are omitted", async () => {
    const app = buildApp({ readinessCheck: async () => undefined });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/public/example-tenant/availability",
    });

    expect(response.statusCode).toBe(404);
  });
});
