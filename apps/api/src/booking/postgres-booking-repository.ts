import type { Pool } from "pg";
import type {
  BookingRepository,
  BookingReservationResult,
  NewBookingReservation,
} from "./create-booking-service.js";

interface BookingRow {
  attendee_email: string;
  attendee_name: string;
  ends_at: Date;
  id: string;
  starts_at: Date;
  status: "confirmed" | "failed" | "pending";
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
