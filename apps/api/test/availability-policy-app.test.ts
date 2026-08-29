import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AuthenticatedPrincipal } from "../src/auth/session-services.js";
import type {
  GetTenantAvailabilityPolicyService,
  ReplaceTenantAvailabilityPolicyService,
} from "../src/availability/policy-services.js";

const apps: ReturnType<typeof buildApp>[] = [];
const tenantId = "00000000-0000-4000-8000-000000000421";
const principal: AuthenticatedPrincipal = {
  email: "owner@example.com",
  memberships: [{ role: "owner", tenantId }],
  userId: "00000000-0000-4000-8000-000000000422",
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("availability policy app-factory wiring", () => {
  it("registers owner GET and PUT routes when dependencies are supplied", async () => {
    const getPolicy = vi.fn<GetTenantAvailabilityPolicyService["execute"]>(
      async () => ({ policy: null, tenantId }),
    );
    const replacePolicy = vi.fn<ReplaceTenantAvailabilityPolicyService["execute"]>(
      async (command) => ({ policy: command.policy, tenantId }),
    );
    const app = buildApp({
      availabilityPolicy: {
        authenticateSession: { execute: vi.fn(async () => principal) },
        getPolicy: { execute: getPolicy },
        replacePolicy: { execute: replacePolicy },
      },
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const response = await app.inject({
      headers: { cookie: "calenolav_session=presented" },
      method: "GET",
      url: `/tenants/${tenantId}/availability-policy`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { policy: null, tenantId } });
  });

  it("does not expose owner policy routes when dependencies are omitted", async () => {
    const app = buildApp({ readinessCheck: async () => undefined });
    apps.push(app);

    const responses = await Promise.all([
      app.inject({ method: "GET", url: `/tenants/${tenantId}/availability-policy` }),
      app.inject({ method: "PUT", payload: {}, url: `/tenants/${tenantId}/availability-policy` }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([404, 404]);
  });
});
