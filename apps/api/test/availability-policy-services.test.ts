import { describe, expect, it, vi } from "vitest";
import {
  AuthorizationError,
  type AuthenticatedPrincipal,
} from "../src/auth/session-services.js";
import {
  GetTenantAvailabilityPolicyService,
  ReplaceTenantAvailabilityPolicyService,
  type AvailabilityPolicyRepository,
} from "../src/availability/policy-services.js";
import { AvailabilityPolicyValidationError } from "../src/availability/weekly-policy.js";

const tenantId = "00000000-0000-4000-8000-000000000401";
const otherTenantId = "00000000-0000-4000-8000-000000000402";
const principal: AuthenticatedPrincipal = {
  email: "owner@example.com",
  memberships: [{ role: "owner", tenantId }],
  userId: "00000000-0000-4000-8000-000000000403",
};
const policy = {
  bookingWindowDays: 60,
  minimumNoticeMinutes: 120,
  slotDurationMinutes: 30,
  timeZone: "America/Bogota",
  windows: [
    { endMinute: 1020, startMinute: 780, weekday: 3 },
    { endMinute: 720, startMinute: 540, weekday: 1 },
  ],
};

function createRepository(): AvailabilityPolicyRepository {
  return {
    findPolicy: vi.fn(async () => policy),
    replacePolicy: vi.fn(async () => undefined),
  };
}

describe("tenant availability policy services", () => {
  it("returns the tenant policy only to its owner", async () => {
    const repository = createRepository();
    const service = new GetTenantAvailabilityPolicyService({ repository });

    await expect(service.execute({ principal, tenantId })).resolves.toEqual({
      policy,
      tenantId,
    });
    expect(repository.findPolicy).toHaveBeenCalledWith(tenantId);
  });

  it("returns an explicit null when the tenant has no policy", async () => {
    const repository = createRepository();
    vi.mocked(repository.findPolicy).mockResolvedValueOnce(null);
    const service = new GetTenantAvailabilityPolicyService({ repository });

    await expect(service.execute({ principal, tenantId })).resolves.toEqual({
      policy: null,
      tenantId,
    });
  });

  it("normalizes and atomically replaces the selected tenant policy", async () => {
    const repository = createRepository();
    const service = new ReplaceTenantAvailabilityPolicyService({ repository });

    const result = await service.execute({
      policy: { ...policy, timeZone: " America/Bogota " },
      principal,
      tenantId,
    });

    const normalizedPolicy = {
      ...policy,
      windows: [
        { endMinute: 720, startMinute: 540, weekday: 1 },
        { endMinute: 1020, startMinute: 780, weekday: 3 },
      ],
    };
    expect(repository.replacePolicy).toHaveBeenCalledWith(
      tenantId,
      normalizedPolicy,
    );
    expect(result).toEqual({ policy: normalizedPolicy, tenantId });
  });

  it("rejects invalid policy before repository access", async () => {
    const repository = createRepository();
    const service = new ReplaceTenantAvailabilityPolicyService({ repository });

    await expect(
      service.execute({
        policy: { ...policy, timeZone: "Not/A-Time-Zone" },
        principal,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(AvailabilityPolicyValidationError);
    expect(repository.replacePolicy).not.toHaveBeenCalled();
  });

  it.each([
    ["read", "findPolicy"],
    ["replace", "replacePolicy"],
  ] as const)("rejects cross-tenant %s before repository access", async (_label, method) => {
    const repository = createRepository();
    const service = method === "findPolicy"
      ? new GetTenantAvailabilityPolicyService({ repository })
      : new ReplaceTenantAvailabilityPolicyService({ repository });
    const command = method === "findPolicy"
      ? { principal, tenantId: otherTenantId }
      : { policy, principal, tenantId: otherTenantId };

    await expect(service.execute(command as never)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(repository[method]).not.toHaveBeenCalled();
  });
});
