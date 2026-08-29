import { describe, expect, it, vi } from "vitest";
import {
  BookingConflictError,
  BookingNotFoundError,
  BookingUnavailableError,
  CreateBookingService,
  type BookingRepository,
} from "../src/booking/create-booking-service.js";
import { BookingRequestValidationError } from "../src/booking/booking-request.js";
import type { PublicAvailabilityRepository } from "../src/availability/public-availability-service.js";

const tenantId = "00000000-0000-4000-8000-000000000701";
const bookingId = "00000000-0000-4000-8000-000000000702";
const freeBusyScope = "https://www.googleapis.com/auth/calendar.freebusy";
const eventScope = "https://www.googleapis.com/auth/calendar.events.owned";
const encryptedRefreshToken = {
  authTag: "synthetic-auth-tag",
  ciphertext: "synthetic-ciphertext",
  iv: "synthetic-iv",
  keyVersion: 2,
};
const request = {
  attendeeEmail: " Visitor@Example.com ",
  attendeeName: " Ada Lovelace ",
  idempotencyKey: "110ec58a-a0f2-4ac4-8393-c866d813b8d1",
  startAt: "2026-09-07T14:30:00.000Z",
  tenantSlug: " Example-Tenant ",
};
const source = {
  calendarId: "primary",
  grantedScopes: [freeBusyScope, eventScope],
  policy: {
    bookingWindowDays: 1,
    minimumNoticeMinutes: 120,
    slotDurationMinutes: 30,
    timeZone: "America/Bogota",
    windows: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
  },
  refreshToken: encryptedRefreshToken,
  tenantId,
};

function createDependencies() {
  const availabilityRepository: PublicAvailabilityRepository = {
    findSourceBySlug: vi.fn(async () => source),
  };
  const bookingRepository: BookingRepository = {
    confirmBooking: vi.fn(async () => undefined),
    failBooking: vi.fn(async () => undefined),
    reserveBooking: vi.fn(async () => ({
      bookingId,
      outcome: "created" as const,
    })),
  };
  const decrypt = vi.fn(() => "long-lived-refresh-token");
  const queryBusyIntervals = vi.fn(
    async (): Promise<Array<{ endAt: Date; startAt: Date }>> => [],
  );
  const createEvent = vi.fn(async () => ({ googleEventId: "google-event-id" }));
  return {
    availabilityRepository,
    bookingRepository,
    clock: () => new Date("2026-09-07T12:10:00.000Z"),
    eventClient: { createEvent },
    freeBusyClient: { queryBusyIntervals },
    secretBox: { decrypt },
  };
}

describe("CreateBookingService", () => {
  it("revalidates, reserves, creates one event, and confirms the booking", async () => {
    const dependencies = createDependencies();
    const service = new CreateBookingService(dependencies);

    await expect(service.execute(request)).resolves.toEqual({
      bookingId,
      endAt: new Date("2026-09-07T15:00:00.000Z"),
      startAt: new Date("2026-09-07T14:30:00.000Z"),
      status: "confirmed",
    });
    expect(dependencies.availabilityRepository.findSourceBySlug).toHaveBeenCalledWith(
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
    expect(dependencies.bookingRepository.reserveBooking).toHaveBeenCalledWith({
      attendeeEmail: "visitor@example.com",
      attendeeName: "Ada Lovelace",
      endAt: new Date("2026-09-07T15:00:00.000Z"),
      idempotencyKey: request.idempotencyKey,
      startAt: new Date("2026-09-07T14:30:00.000Z"),
      tenantId,
    });
    expect(dependencies.eventClient.createEvent).toHaveBeenCalledWith({
      attendeeEmail: "visitor@example.com",
      bookingId,
      calendarId: "primary",
      endAt: new Date("2026-09-07T15:00:00.000Z"),
      refreshToken: "long-lived-refresh-token",
      startAt: new Date("2026-09-07T14:30:00.000Z"),
    });
    expect(dependencies.bookingRepository.confirmBooking).toHaveBeenCalledWith({
      bookingId,
      googleEventId: "google-event-id",
    });
  });

  it("rejects malformed input before every dependency", async () => {
    const dependencies = createDependencies();
    const service = new CreateBookingService(dependencies);

    await expect(
      service.execute({ ...request, startAt: "not-an-instant" }),
    ).rejects.toBeInstanceOf(BookingRequestValidationError);
    expect(dependencies.availabilityRepository.findSourceBySlug).not.toHaveBeenCalled();
  });

  it.each([
    ["missing source", null],
    ["missing FreeBusy scope", { ...source, grantedScopes: [eventScope] }],
    ["missing event scope", { ...source, grantedScopes: [freeBusyScope] }],
  ] as const)("uses one not-found result for %s", async (_label, record) => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.availabilityRepository.findSourceBySlug).mockResolvedValueOnce(
      record,
    );
    const service = new CreateBookingService(dependencies);

    await expect(service.execute(request)).rejects.toBeInstanceOf(
      BookingNotFoundError,
    );
    expect(dependencies.secretBox.decrypt).not.toHaveBeenCalled();
    expect(dependencies.bookingRepository.reserveBooking).not.toHaveBeenCalled();
  });

  it("rejects a start that current rules or busy ranges do not expose", async () => {
    const dependencies = createDependencies();
    dependencies.freeBusyClient.queryBusyIntervals.mockResolvedValueOnce([
      {
        endAt: new Date("2026-09-07T15:00:00.000Z"),
        startAt: new Date("2026-09-07T14:30:00.000Z"),
      },
    ]);
    const service = new CreateBookingService(dependencies);

    await expect(service.execute(request)).rejects.toBeInstanceOf(
      BookingConflictError,
    );
    expect(dependencies.bookingRepository.reserveBooking).not.toHaveBeenCalled();
    expect(dependencies.eventClient.createEvent).not.toHaveBeenCalled();
  });

  it("returns an already confirmed idempotent reservation without another event", async () => {
    const dependencies = createDependencies();
    dependencies.bookingRepository.reserveBooking = vi.fn(async () => ({
      bookingId,
      outcome: "confirmed" as const,
    }));
    const service = new CreateBookingService(dependencies);

    await expect(service.execute(request)).resolves.toMatchObject({
      bookingId,
      status: "confirmed",
    });
    expect(dependencies.eventClient.createEvent).not.toHaveBeenCalled();
    expect(dependencies.bookingRepository.confirmBooking).not.toHaveBeenCalled();
  });

  it("uses one conflict for idempotency mismatch or a local overlap", async () => {
    const dependencies = createDependencies();
    dependencies.bookingRepository.reserveBooking = vi.fn(async () => ({
      bookingId,
      outcome: "conflict" as const,
    }));
    const service = new CreateBookingService(dependencies);

    await expect(service.execute(request)).rejects.toBeInstanceOf(
      BookingConflictError,
    );
    expect(dependencies.eventClient.createEvent).not.toHaveBeenCalled();
  });

  it("marks a new reservation failed when Google event creation fails", async () => {
    const dependencies = createDependencies();
    dependencies.eventClient.createEvent.mockRejectedValueOnce(
      new Error("provider detail"),
    );
    const service = new CreateBookingService(dependencies);

    await expect(service.execute(request)).rejects.toBeInstanceOf(
      BookingUnavailableError,
    );
    expect(dependencies.bookingRepository.failBooking).toHaveBeenCalledWith(
      bookingId,
    );
    expect(dependencies.bookingRepository.confirmBooking).not.toHaveBeenCalled();
  });

  it("leaves a post-event confirmation failure pending for reconciliation", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.bookingRepository.confirmBooking).mockRejectedValueOnce(
      new Error("database detail"),
    );
    const service = new CreateBookingService(dependencies);

    await expect(service.execute(request)).rejects.toBeInstanceOf(
      BookingUnavailableError,
    );
    expect(dependencies.eventClient.createEvent).toHaveBeenCalledOnce();
    expect(dependencies.bookingRepository.failBooking).not.toHaveBeenCalled();
  });

  it.each(["source", "decryption", "freebusy"] as const)(
    "maps %s dependency failure to one unavailable result",
    async (failure) => {
      const dependencies = createDependencies();
      if (failure === "source") {
        vi.mocked(
          dependencies.availabilityRepository.findSourceBySlug,
        ).mockRejectedValueOnce(new Error("database detail"));
      } else if (failure === "decryption") {
        dependencies.secretBox.decrypt.mockImplementationOnce(() => {
          throw new Error("cryptographic detail");
        });
      } else {
        dependencies.freeBusyClient.queryBusyIntervals.mockRejectedValueOnce(
          new Error("provider detail"),
        );
      }
      const service = new CreateBookingService(dependencies);

      await expect(service.execute(request)).rejects.toBeInstanceOf(
        BookingUnavailableError,
      );
    },
  );

  it("exports stable privacy-safe booking errors", () => {
    expect(new BookingNotFoundError()).toMatchObject({
      message: "Booking destination was not found.",
      name: "BookingNotFoundError",
    });
    expect(new BookingConflictError()).toMatchObject({
      message: "The selected time is no longer available.",
      name: "BookingConflictError",
    });
    expect(new BookingUnavailableError()).toMatchObject({
      message: "Booking could not be completed.",
      name: "BookingUnavailableError",
    });
  });
});
