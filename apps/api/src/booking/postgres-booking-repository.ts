import type { Pool } from "pg";
import type {
  BookingRepository,
  BookingReservationResult,
  NewBookingReservation,
} from "./create-booking-service.js";
import type {
  PendingBookingClaim,
  PendingBookingForReconciliation,
} from "./reconcile-pending-bookings.js";

interface BookingRow {
  attendee_email: string;
  attendee_name: string;
  ends_at: Date;
  id: string;
  starts_at: Date;
  status: "confirmed" | "failed" | "pending";
}

interface BookingRecoveryRow {
  attendee_email: string;
  booking_id: string;
  calendar_id: string;
  encryption_key_version: number;
  ends_at: Date;
  refresh_token_auth_tag: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  starts_at: Date;
  tenant_id: string;
}

function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function matchesReservation(
  row: BookingRow,
  input: NewBookingReservation,
): boolean {
  return (
    row.attendee_email === input.attendeeEmail &&
    row.attendee_name === input.attendeeName &&
    row.starts_at.getTime() === input.startAt.getTime() &&
    row.ends_at.getTime() === input.endAt.getTime()
  );
}

export class PostgresBookingRepository implements BookingRepository {
  constructor(private readonly pool: Pool) {}

  async reserveBooking(
    input: NewBookingReservation,
  ): Promise<BookingReservationResult> {
    try {
      const inserted = await this.pool.query<{ id: string }>(
        `INSERT INTO bookings (
           tenant_id, idempotency_key, attendee_name, attendee_email,
           starts_at, ends_at, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          input.tenantId,
          input.idempotencyKey,
          input.attendeeName,
          input.attendeeEmail,
          input.startAt,
          input.endAt,
        ],
      );
      const bookingId = inserted.rows[0]?.id;
      if (bookingId) return { bookingId, outcome: "created" };

      const existing = await this.findByIdempotencyKey(input);
      if (!existing) throw new Error("Booking reservation could not be resolved.");
      return {
        bookingId: existing.id,
        outcome:
          existing.status === "confirmed" && matchesReservation(existing, input)
            ? "confirmed"
            : "conflict",
      };
    } catch (error) {
      if (!isPostgresError(error, "23P01")) throw error;
      const conflict = await this.findOverlappingBooking(input);
      if (!conflict) throw new Error("Booking conflict could not be resolved.");
      return { bookingId: conflict.id, outcome: "conflict" };
    }
  }

  async confirmBooking(input: {
    bookingId: string;
    googleEventId: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE bookings
          SET status = 'confirmed', google_event_id = $2, updated_at = now()
        WHERE id = $1 AND status = 'pending'
      RETURNING id`,
      [input.bookingId, input.googleEventId],
    );
    if (result.rowCount !== 1) {
      throw new Error("Booking state transition failed.");
    }
  }

  async failBooking(bookingId: string): Promise<void> {
    await this.pool.query(
      `UPDATE bookings
          SET status = 'failed', updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [bookingId],
    );
  }

  async claimPendingBookings(
    input: PendingBookingClaim,
  ): Promise<PendingBookingForReconciliation[]> {
    const result = await this.pool.query<BookingRecoveryRow>(
      `WITH candidates AS (
         SELECT booking.id
           FROM bookings AS booking
           JOIN google_calendar_connections AS connection
             ON connection.tenant_id = booking.tenant_id
          WHERE booking.status = 'pending'
            AND booking.updated_at <= $1
          ORDER BY booking.updated_at, booking.id
          FOR UPDATE OF booking SKIP LOCKED
          LIMIT $2
       ), claimed AS (
         UPDATE bookings AS booking
            SET updated_at = $3
           FROM candidates
          WHERE booking.id = candidates.id
        RETURNING booking.id AS booking_id, booking.tenant_id,
                  booking.attendee_email, booking.starts_at, booking.ends_at
       )
       SELECT claimed.booking_id, claimed.tenant_id, claimed.attendee_email,
              claimed.starts_at, claimed.ends_at, connection.calendar_id,
              connection.refresh_token_ciphertext,
              connection.refresh_token_iv,
              connection.refresh_token_auth_tag,
              connection.encryption_key_version
         FROM claimed
         JOIN google_calendar_connections AS connection
           ON connection.tenant_id = claimed.tenant_id
        ORDER BY claimed.booking_id`,
      [input.staleBefore, input.limit, input.claimedAt],
    );

    return result.rows.map((row) => ({
      attendeeEmail: row.attendee_email,
      bookingId: row.booking_id,
      calendarId: row.calendar_id,
      endAt: row.ends_at,
      refreshToken: {
        authTag: row.refresh_token_auth_tag,
        ciphertext: row.refresh_token_ciphertext,
        iv: row.refresh_token_iv,
        keyVersion: row.encryption_key_version,
      },
      startAt: row.starts_at,
      tenantId: row.tenant_id,
    }));
  }

  private async findByIdempotencyKey(
    input: NewBookingReservation,
  ): Promise<BookingRow | null> {
    const result = await this.pool.query<BookingRow>(
      `SELECT id, attendee_name, attendee_email, starts_at, ends_at, status
         FROM bookings
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [input.tenantId, input.idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  private async findOverlappingBooking(
    input: NewBookingReservation,
  ): Promise<{ id: string } | null> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM bookings
        WHERE tenant_id = $1
          AND status IN ('pending', 'confirmed')
          AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2, $3, '[)')
        ORDER BY created_at
        LIMIT 1`,
      [input.tenantId, input.startAt, input.endAt],
    );
    return result.rows[0] ?? null;
  }
}
