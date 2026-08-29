import type { PublicAvailabilityRepository } from "../availability/public-availability-service.js";
import {
  calculateAvailabilityQueryRange,
  calculateAvailableSlots,
  type BusyInterval,
} from "../availability/slot-calculator.js";
import { GOOGLE_CALENDAR_FREEBUSY_SCOPE } from "../google/oauth-authorization.js";
import type { EncryptedSecret } from "../google/secret-box.js";
import {
  normalizePublicBookingRequest,
  type PublicBookingRequest,
} from "./booking-request.js";

const googleCalendarEventsOwnedScope =
  "https://www.googleapis.com/auth/calendar.events.owned";

export interface NewBookingReservation {
  attendeeEmail: string;
  attendeeName: string;
  endAt: Date;
  idempotencyKey: string;
  startAt: Date;
  tenantId: string;
}

export interface BookingReservationResult {
  bookingId: string;
  outcome: "confirmed" | "conflict" | "created";
}

export interface BookingRepository {
  confirmBooking(input: { bookingId: string; googleEventId: string }): Promise<void>;
  failBooking(bookingId: string): Promise<void>;
  reserveBooking(input: NewBookingReservation): Promise<BookingReservationResult>;
}

interface BookingFreeBusyClient {
  queryBusyIntervals(input: {
    calendarId: string;
    endAt: Date;
    refreshToken: string;
    startAt: Date;
  }): Promise<BusyInterval[]>;
}

interface BookingEventClient {
  createEvent(input: {
    attendeeEmail: string;
    bookingId: string;
    calendarId: string;
    endAt: Date;
    refreshToken: string;
    startAt: Date;
  }): Promise<{ googleEventId: string }>;
}

interface BookingSecretBox {
  decrypt(encrypted: EncryptedSecret, context: string): string;
}

interface CreateBookingDependencies {
  availabilityRepository: PublicAvailabilityRepository;
  bookingRepository: BookingRepository;
  clock: () => Date;
  eventClient: BookingEventClient;
  freeBusyClient: BookingFreeBusyClient;
  secretBox: BookingSecretBox;
}

export interface CreateBookingResult {
  bookingId: string;
  endAt: Date;
  startAt: Date;
  status: "confirmed";
}

export class BookingNotFoundError extends Error {
  override readonly name = "BookingNotFoundError";
  constructor() {
    super("Booking destination was not found.");
  }
}

export class BookingConflictError extends Error {
  override readonly name = "BookingConflictError";
  constructor() {
    super("The selected time is no longer available.");
  }
}

export class BookingUnavailableError extends Error {
  override readonly name = "BookingUnavailableError";
  constructor() {
    super("Booking could not be completed.");
  }
}

function hasRequiredScopes(grantedScopes: readonly string[]): boolean {
  return (
    grantedScopes.includes(GOOGLE_CALENDAR_FREEBUSY_SCOPE) &&
    grantedScopes.includes(googleCalendarEventsOwnedScope)
  );
}

export class CreateBookingService {
  constructor(private readonly dependencies: CreateBookingDependencies) {}

  async execute(request: PublicBookingRequest): Promise<CreateBookingResult> {
    const normalized = normalizePublicBookingRequest(request);

    let source;
    try {
      source = await this.dependencies.availabilityRepository.findSourceBySlug(
        normalized.tenantSlug,
      );
    } catch {
      throw new BookingUnavailableError();
    }
    if (!source || !hasRequiredScopes(source.grantedScopes)) {
      throw new BookingNotFoundError();
    }

    let refreshToken: string;
    let selectedSlot: { endAt: Date; startAt: Date } | undefined;
    try {
      const now = this.dependencies.clock();
      if (source.policy.windows.length === 0) throw new BookingConflictError();
      const queryRange = calculateAvailabilityQueryRange({
        now,
        policy: source.policy,
      });
      refreshToken = this.dependencies.secretBox
        .decrypt(source.refreshToken, `google-refresh-token:${source.tenantId}`)
        .trim();
      if (refreshToken.length === 0) throw new BookingUnavailableError();
      const busyIntervals =
        await this.dependencies.freeBusyClient.queryBusyIntervals({
          calendarId: source.calendarId,
          endAt: queryRange.endAt,
          refreshToken,
          startAt: queryRange.startAt,
        });
      selectedSlot = calculateAvailableSlots({
        busyIntervals,
        now,
        policy: source.policy,
      }).find(
        (slot) => slot.startAt.getTime() === normalized.startAt.getTime(),
      );
    } catch (error) {
      if (error instanceof BookingConflictError) throw error;
      throw new BookingUnavailableError();
    }
    if (!selectedSlot) throw new BookingConflictError();

    let reservation: BookingReservationResult;
    try {
      reservation = await this.dependencies.bookingRepository.reserveBooking({
        attendeeEmail: normalized.attendeeEmail,
        attendeeName: normalized.attendeeName,
        endAt: selectedSlot.endAt,
        idempotencyKey: normalized.idempotencyKey,
        startAt: selectedSlot.startAt,
        tenantId: source.tenantId,
      });
    } catch {
      throw new BookingUnavailableError();
    }
    if (reservation.outcome === "conflict") throw new BookingConflictError();
    if (reservation.outcome === "confirmed") {
      return {
        bookingId: reservation.bookingId,
        endAt: selectedSlot.endAt,
        startAt: selectedSlot.startAt,
        status: "confirmed",
      };
    }

    let googleEventId: string;
    try {
      ({ googleEventId } = await this.dependencies.eventClient.createEvent({
        attendeeEmail: normalized.attendeeEmail,
        bookingId: reservation.bookingId,
        calendarId: source.calendarId,
        endAt: selectedSlot.endAt,
        refreshToken,
        startAt: selectedSlot.startAt,
      }));
    } catch {
      try {
        await this.dependencies.bookingRepository.failBooking(reservation.bookingId);
      } catch {
        // Cleanup is best effort; the public error remains generic.
      }
      throw new BookingUnavailableError();
    }

    try {
      await this.dependencies.bookingRepository.confirmBooking({
        bookingId: reservation.bookingId,
        googleEventId,
      });
    } catch {
      // Google may already contain the event. Pending preserves the interval
      // until reconciliation can safely confirm the deterministic event.
      throw new BookingUnavailableError();
    }

    return {
      bookingId: reservation.bookingId,
      endAt: selectedSlot.endAt,
      startAt: selectedSlot.startAt,
      status: "confirmed",
    };
  }
}
