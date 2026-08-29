import { describe, expect, it, vi } from "vitest";
import {
  GetPublicAvailabilityService,
  PublicAvailabilityNotFoundError,
  PublicAvailabilityUnavailableError,
  type PublicAvailabilityRepository,
} from "../src/availability/public-availability-service.js";
import type { AvailabilityPolicy } from "../src/availability/weekly-policy.js";

const freeBusyScope = "https://www.googleapis.com/auth/calendar.freebusy";
const tenantId = "00000000-0000-4000-8000-000000000501";
const encryptedRefreshToken = {
  authTag: "synthetic-auth-tag",
  ciphertext: "synthetic-ciphertext",
  iv: "synthetic-iv",
  keyVersion: 2,
};
const policy: AvailabilityPolicy = {
  bookingWindowDays: 1,
  minimumNoticeMinutes: 120,
  slotDurationMinutes: 30,
  timeZone: "America/Bogota",
  windows: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
};
const source = {
  calendarId: "primary",
  grantedScopes: [freeBusyScope],
  policy,
  refreshToken: encryptedRefreshToken,
  tenantId,
};

function createDependencies() {
  const repository: PublicAvailabilityRepository = {
    findSourceBySlug: vi.fn(async () => source),
  };
  const decrypt = vi.fn(() => "long-lived-refresh-token");
  const queryBusyIntervals = vi.fn(async () => [
    {
      endAt: new Date("2026-09-07T15:45:00.000Z"),
      startAt: new Date("2026-09-07T15:15:00.000Z"),
    },
  ]);
  return {
    clock: () => new Date("2026-09-07T12:10:00.000Z"),
    freeBusyClient: { queryBusyIntervals },
    repository,
    secretBox: { decrypt },
  };
}

describe("GetPublicAvailabilityService", () => {
  it("loads one public source, opens its tenant credential, and returns slots only", async () => {
    const dependencies = createDependencies();
    const service = new GetPublicAvailabilityService(dependencies);

    const result = await service.execute({ slug: "example-tenant" });

    expect(dependencies.repository.findSourceBySlug).toHaveBeenCalledWith(
      "example-tenant",
    );
    expect(dependencies.secretBox.decrypt).toHaveBeenCalledWith(
      encryptedRefreshToken,
      `google-refresh-token:${tenantId}`,
    );
    expect(dependencies.freeBusyClient.queryBusyIntervals).toHaveBeenCalledWith({
      calendarId: "primary",
      endAt: new Date("2026-09-08T12:10:00.000Z"),
      refreshToken: "long-lived-refresh-token",
      startAt: new Date("2026-09-07T14:10:00.000Z"),
    });
    expect(
      result.slots.map((slot) => ({
        endAt: slot.endAt.toISOString(),
        startAt: slot.startAt.toISOString(),
      })),
    ).toEqual([
      {
        endAt: "2026-09-07T15:00:00.000Z",
        startAt: "2026-09-07T14:30:00.000Z",
      },
      {
        endAt: "2026-09-07T16:30:00.000Z",
        startAt: "2026-09-07T16:00:00.000Z",
      },
      {
        endAt: "2026-09-07T17:00:00.000Z",
        startAt: "2026-09-07T16:30:00.000Z",
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /tenant|calendar|token|cipher|scope/iu,
    );
  });

  it("returns an empty published schedule without opening or querying credentials", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findSourceBySlug).mockResolvedValueOnce({
      ...source,
      policy: { ...policy, windows: [] },
    });
    const service = new GetPublicAvailabilityService(dependencies);

    await expect(service.execute({ slug: "example-tenant" })).resolves.toEqual({
      slots: [],
    });
    expect(dependencies.secretBox.decrypt).not.toHaveBeenCalled();
    expect(dependencies.freeBusyClient.queryBusyIntervals).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown tenant", null],
    ["connection without free/busy scope", { ...source, grantedScopes: [] }],
  ] as const)("uses one not-found result for %s", async (_label, record) => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findSourceBySlug).mockResolvedValueOnce(
      record,
    );
    const service = new GetPublicAvailabilityService(dependencies);

    await expect(service.execute({ slug: "example-tenant" })).rejects.toBeInstanceOf(
      PublicAvailabilityNotFoundError,
    );
    expect(dependencies.secretBox.decrypt).not.toHaveBeenCalled();
    expect(dependencies.freeBusyClient.queryBusyIntervals).not.toHaveBeenCalled();
  });

  it("rejects malformed slugs before repository access", async () => {
    const dependencies = createDependencies();
    const service = new GetPublicAvailabilityService(dependencies);

    await expect(service.execute({ slug: "Not Safe" })).rejects.toBeInstanceOf(
      PublicAvailabilityNotFoundError,
    );
    expect(dependencies.repository.findSourceBySlug).not.toHaveBeenCalled();
  });

  it.each(["repository", "decryption", "provider"] as const)(
    "maps %s failure to one unavailable error",
    async (failure) => {
      const dependencies = createDependencies();
      if (failure === "repository") {
        vi.mocked(dependencies.repository.findSourceBySlug).mockRejectedValueOnce(
          new Error("database detail"),
        );
      } else if (failure === "decryption") {
        dependencies.secretBox.decrypt.mockImplementationOnce(() => {
          throw new Error("cryptographic detail");
        });
      } else {
        dependencies.freeBusyClient.queryBusyIntervals.mockRejectedValueOnce(
          new Error("provider detail"),
        );
      }
      const service = new GetPublicAvailabilityService(dependencies);

      await expect(
        service.execute({ slug: "example-tenant" }),
      ).rejects.toBeInstanceOf(PublicAvailabilityUnavailableError);
    },
  );

  it("exports stable privacy-safe public errors", () => {
    expect(new PublicAvailabilityNotFoundError()).toMatchObject({
      message: "Public availability was not found.",
      name: "PublicAvailabilityNotFoundError",
    });
    expect(new PublicAvailabilityUnavailableError()).toMatchObject({
      message: "Public availability is temporarily unavailable.",
      name: "PublicAvailabilityUnavailableError",
    });
  });
});
