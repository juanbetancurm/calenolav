import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "../src/auth/session-services.js";
import type { AuthenticatedPrincipal } from "../src/auth/session-services.js";
import {
  DisconnectGoogleCalendarService,
  GetGoogleCalendarConnectionStatusService,
  type GoogleCalendarConnectionManagementRepository,
} from "../src/google/connection-services.js";

const tenantId = "00000000-0000-4000-8000-000000000201";
const otherTenantId = "00000000-0000-4000-8000-000000000202";
const principal: AuthenticatedPrincipal = {
  email: "owner@example.com",
  memberships: [{ role: "owner", tenantId }],
  userId: "00000000-0000-4000-8000-000000000203",
};
const storedConnection = {
  calendarId: "primary",
  connectedAt: new Date("2026-08-20T10:00:00.000Z"),
  googleAccountEmail: "calendar-owner@example.com",
  grantedScopes: [
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/calendar.events.owned",
  ],
  updatedAt: new Date("2026-08-20T11:00:00.000Z"),
};

function createRepository(): GoogleCalendarConnectionManagementRepository {
  return {
    deleteConnection: vi.fn(async () => undefined),
    findConnectionStatus: vi.fn(async () => storedConnection),
  };
}

describe("GetGoogleCalendarConnectionStatusService", () => {
  it("returns only safe connection metadata to the tenant owner", async () => {
    const repository = createRepository();
    const service = new GetGoogleCalendarConnectionStatusService({ repository });

    const result = await service.execute({ principal, tenantId });

    expect(repository.findConnectionStatus).toHaveBeenCalledWith(tenantId);
    expect(result).toEqual({ connected: true, tenantId, ...storedConnection });
    expect(JSON.stringify(result)).not.toContain("ciphertext");
    expect(JSON.stringify(result)).not.toContain("googleSubject");
    expect(JSON.stringify(result)).not.toContain("refreshToken");
  });

  it("returns a tenant-scoped disconnected status when no row exists", async () => {
    const repository = createRepository();
    vi.mocked(repository.findConnectionStatus).mockResolvedValueOnce(null);
    const service = new GetGoogleCalendarConnectionStatusService({ repository });

    await expect(service.execute({ principal, tenantId })).resolves.toEqual({
      connected: false,
      tenantId,
    });
  });

  it.each([
    {
      name: "a member",
      principal: {
        ...principal,
        memberships: [{ role: "member" as const, tenantId }],
      },
      tenantId,
    },
    { name: "an owner of another tenant", principal, tenantId: otherTenantId },
  ])("rejects $name before reading connection state", async (input) => {
    const repository = createRepository();
    const service = new GetGoogleCalendarConnectionStatusService({ repository });

    await expect(service.execute(input)).rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.findConnectionStatus).not.toHaveBeenCalled();
  });
});

describe("DisconnectGoogleCalendarService", () => {
  it("deletes only the selected tenant connection and is safe to repeat", async () => {
    const repository = createRepository();
    const service = new DisconnectGoogleCalendarService({ repository });

    await service.execute({ principal, tenantId });
    await service.execute({ principal, tenantId });

    expect(repository.deleteConnection).toHaveBeenNthCalledWith(1, tenantId);
    expect(repository.deleteConnection).toHaveBeenNthCalledWith(2, tenantId);
  });

  it("rejects an unauthorized tenant before deleting anything", async () => {
    const repository = createRepository();
    const service = new DisconnectGoogleCalendarService({ repository });

    await expect(
      service.execute({ principal, tenantId: otherTenantId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.deleteConnection).not.toHaveBeenCalled();
  });
});
