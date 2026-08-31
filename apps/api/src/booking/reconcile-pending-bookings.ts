import type { EncryptedSecret } from "../google/secret-box.js";

export interface PendingBookingForReconciliation {
  attendeeEmail: string;
  bookingId: string;
  calendarId: string;
  endAt: Date;
  refreshToken: EncryptedSecret;
  startAt: Date;
  tenantId: string;
}

export interface PendingBookingClaim {
  claimedAt: Date;
  limit: number;
  staleBefore: Date;
}

interface BookingReconciliationRepository {
  claimPendingBookings(
    input: PendingBookingClaim,
  ): Promise<PendingBookingForReconciliation[]>;
  confirmBooking(input: {
    bookingId: string;
    googleEventId: string;
  }): Promise<void>;
}

interface ReconciliationEventClient {
  createEvent(input: {
    attendeeEmail: string;
    bookingId: string;
    calendarId: string;
    endAt: Date;
    refreshToken: string;
    startAt: Date;
  }): Promise<{ googleEventId: string }>;
}

interface ReconciliationSecretBox {
  decrypt(encrypted: EncryptedSecret, context: string): string;
}

interface ReconcilePendingBookingsDependencies {
  batchSize: number;
  clock: () => Date;
  eventClient: ReconciliationEventClient;
  repository: BookingReconciliationRepository;
  retryDelayMs: number;
  secretBox: ReconciliationSecretBox;
}

export interface BookingReconciliationResult {
  claimed: number;
  confirmed: number;
  retryable: number;
}

export class BookingReconciliationError extends Error {
  override readonly name = "BookingReconciliationError";
  constructor() {
    super("Pending bookings could not be reconciled.");
  }
}

function requirePositiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Booking reconciliation configuration is invalid.");
  }
  return value;
}

export class ReconcilePendingBookingsService {
  private readonly batchSize: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly dependencies: ReconcilePendingBookingsDependencies,
  ) {
    this.batchSize = requirePositiveInteger(dependencies.batchSize);
    this.retryDelayMs = requirePositiveInteger(dependencies.retryDelayMs);
  }

  async execute(): Promise<BookingReconciliationResult> {
    const claimedAt = this.dependencies.clock();
    const claimedAtMs = claimedAt.getTime();
    if (!Number.isFinite(claimedAtMs)) throw new BookingReconciliationError();

    let pendingBookings: PendingBookingForReconciliation[];
    try {
      pendingBookings = await this.dependencies.repository.claimPendingBookings({
        claimedAt,
        limit: this.batchSize,
        staleBefore: new Date(claimedAtMs - this.retryDelayMs),
      });
    } catch {
      throw new BookingReconciliationError();
    }

    let confirmed = 0;
    let retryable = 0;
    for (const booking of pendingBookings) {
      try {
        const refreshToken = this.dependencies.secretBox
          .decrypt(
            booking.refreshToken,
            `google-refresh-token:${booking.tenantId}`,
          )
          .trim();
        if (refreshToken.length === 0) throw new BookingReconciliationError();
        const { googleEventId } = await this.dependencies.eventClient.createEvent({
          attendeeEmail: booking.attendeeEmail,
          bookingId: booking.bookingId,
          calendarId: booking.calendarId,
          endAt: booking.endAt,
          refreshToken,
          startAt: booking.startAt,
        });
        await this.dependencies.repository.confirmBooking({
          bookingId: booking.bookingId,
          googleEventId,
        });
        confirmed += 1;
      } catch {
        retryable += 1;
      }
    }

    return {
      claimed: pendingBookings.length,
      confirmed,
      retryable,
    };
  }
}
