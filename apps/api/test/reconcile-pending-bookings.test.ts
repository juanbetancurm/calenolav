import { describe, expect, it, vi } from "vitest";
import {
  ReconcilePendingBookingsService,
  type PendingBookingForReconciliation,
} from "../src/booking/reconcile-pending-bookings.js";

const now = new Date("2026-09-07T12:00:00.000Z");
const booking: PendingBookingForReconciliation = {
  attendeeEmail: "visitor@example.com",
  bookingId: "00000000-0000-4000-8000-000000000901",
  calendarId: "primary",
  endAt: new Date("2026-09-07T15:00:00.000Z"),
  refreshToken: {
    authTag: "auth-tag",
    ciphertext: "ciphertext",
    iv: "initial-vector",
    keyVersion: 1,
  },
  startAt: new Date("2026-09-07T14:30:00.000Z"),
  tenantId: "00000000-0000-4000-8000-000000000902",
};

function createDependencies(records = [booking]) {
  const repository = {
    claimPendingBookings: vi.fn(async () => records),
    confirmBooking: vi.fn(async () => undefined),
  };
  const secretBox = {
    decrypt: vi.fn(() => "recovered-refresh-token"),
  };
  const eventClient = {
    createEvent: vi.fn(async ({ bookingId }: { bookingId: string }) => ({
      googleEventId: bookingId.replaceAll("-", ""),
    })),
  };
  return { eventClient, repository, secretBox };
}

describe("pending booking reconciliation", () => {
  it("claims stale work, recovers one deterministic event, and confirms locally", async () => {
    const dependencies = createDependencies();
    const service = new ReconcilePendingBookingsService({
      ...dependencies,
      batchSize: 25,
      clock: () => now,
      retryDelayMs: 5 * 60 * 1000,
    });

    await expect(service.execute()).resolves.toEqual({
      claimed: 1,
      confirmed: 1,
      retryable: 0,
    });
    expect(dependencies.repository.claimPendingBookings).toHaveBeenCalledWith({
      claimedAt: now,
      limit: 25,
      staleBefore: new Date("2026-09-07T11:55:00.000Z"),
    });
    expect(dependencies.secretBox.decrypt).toHaveBeenCalledWith(
      booking.refreshToken,
      `google-refresh-token:${booking.tenantId}`,
    );
    expect(dependencies.eventClient.createEvent).toHaveBeenCalledWith({
      attendeeEmail: booking.attendeeEmail,
      bookingId: booking.bookingId,
      calendarId: booking.calendarId,
      endAt: booking.endAt,
      refreshToken: "recovered-refresh-token",
      startAt: booking.startAt,
    });
    expect(dependencies.repository.confirmBooking).toHaveBeenCalledWith({
      bookingId: booking.bookingId,
      googleEventId: booking.bookingId.replaceAll("-", ""),
    });
  });

  it("keeps isolated failures pending for a later lease and continues the batch", async () => {
    const second = {
      ...booking,
      bookingId: "00000000-0000-4000-8000-000000000903",
      tenantId: "00000000-0000-4000-8000-000000000904",
    };
    const dependencies = createDependencies([booking, second]);
    dependencies.secretBox.decrypt
      .mockImplementationOnce(() => {
        throw new Error("credential detail");
      })
      .mockReturnValueOnce("second-refresh-token");
    const service = new ReconcilePendingBookingsService({
      ...dependencies,
      batchSize: 10,
      clock: () => now,
      retryDelayMs: 60_000,
    });

    await expect(service.execute()).resolves.toEqual({
      claimed: 2,
      confirmed: 1,
      retryable: 1,
    });
    expect(dependencies.repository.confirmBooking).toHaveBeenCalledTimes(1);
    expect(dependencies.repository.confirmBooking).toHaveBeenCalledWith({
      bookingId: second.bookingId,
      googleEventId: second.bookingId.replaceAll("-", ""),
    });
  });

  it("does not enter credentials or Google when no stale booking is claimed", async () => {
    const dependencies = createDependencies([]);
    const service = new ReconcilePendingBookingsService({
      ...dependencies,
      batchSize: 10,
      clock: () => now,
      retryDelayMs: 60_000,
    });

    await expect(service.execute()).resolves.toEqual({
      claimed: 0,
      confirmed: 0,
      retryable: 0,
    });
    expect(dependencies.secretBox.decrypt).not.toHaveBeenCalled();
    expect(dependencies.eventClient.createEvent).not.toHaveBeenCalled();
  });
});
