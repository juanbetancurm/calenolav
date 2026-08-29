import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PostgresBookingRepository } from "../src/booking/postgres-booking-repository.js";
import { loadEnvironmentFile, readConfig } from "../src/config.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdSlugs: string[] = [];

async function createTenant(): Promise<string> {
  const slug = `booking-repository-${randomUUID()}`;
  createdSlugs.push(slug);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, slug)
     VALUES ('Booking repository test', $1)
     RETURNING id`,
    [slug],
  );
  const tenantId = result.rows[0]?.id;
  if (!tenantId) throw new Error("Booking repository tenant was not created.");
  return tenantId;
}

interface ReservationOverride {
  attendeeEmail?: string;
  attendeeName?: string;
  endAt?: Date;
  idempotencyKey?: string;
  startAt?: Date;
}

function reservation(tenantId: string, override: ReservationOverride = {}) {
  return {
    attendeeEmail: "visitor@example.com",
    attendeeName: "Ada Lovelace",
    endAt: new Date("2026-09-07T15:00:00.000Z"),
    idempotencyKey: randomUUID(),
    startAt: new Date("2026-09-07T14:30:00.000Z"),
    tenantId,
    ...override,
  };
}

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterEach(async () => {
  await pool.query("DELETE FROM tenants WHERE slug = ANY($1::text[])", [
    createdSlugs,
  ]);
  createdSlugs.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe.sequential("PostgresBookingRepository", () => {
  it("reserves, confirms, and returns the same confirmed idempotent booking", async () => {
    const repository = new PostgresBookingRepository(pool);
    const tenantId = await createTenant();
    const input = reservation(tenantId);

    const created = await repository.reserveBooking(input);
    expect(created).toEqual({ bookingId: expect.any(String), outcome: "created" });
    await repository.confirmBooking({
      bookingId: created.bookingId,
      googleEventId: "google-event-id",
    });
    await expect(repository.reserveBooking(input)).resolves.toEqual({
      bookingId: created.bookingId,
      outcome: "confirmed",
    });

    const stored = await pool.query(
      "SELECT status, google_event_id FROM bookings WHERE id = $1",
      [created.bookingId],
    );
    expect(stored.rows).toEqual([
      { google_event_id: "google-event-id", status: "confirmed" },
    ]);
  });

  it("returns one conflict for an idempotency payload mismatch", async () => {
    const repository = new PostgresBookingRepository(pool);
    const tenantId = await createTenant();
    const input = reservation(tenantId);
    const created = await repository.reserveBooking(input);

    await expect(
      repository.reserveBooking({ ...input, attendeeName: "Different visitor" }),
    ).resolves.toEqual({ bookingId: created.bookingId, outcome: "conflict" });
  });

  it("lets PostgreSQL award one overlapping reservation under concurrency", async () => {
    const repository = new PostgresBookingRepository(pool);
    const tenantId = await createTenant();
    const results = await Promise.all([
      repository.reserveBooking(reservation(tenantId)),
      repository.reserveBooking(
        reservation(tenantId, {
          endAt: new Date("2026-09-07T15:15:00.000Z"),
          startAt: new Date("2026-09-07T14:45:00.000Z"),
        }),
      ),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "conflict",
      "created",
    ]);
  });

  it("marks provider failure and releases the interval for another request", async () => {
    const repository = new PostgresBookingRepository(pool);
    const tenantId = await createTenant();
    const first = await repository.reserveBooking(reservation(tenantId));
    await repository.failBooking(first.bookingId);

    await expect(repository.reserveBooking(reservation(tenantId))).resolves.toEqual({
      bookingId: expect.any(String),
      outcome: "created",
    });
    const failed = await pool.query<{ status: string }>(
      "SELECT status FROM bookings WHERE id = $1",
      [first.bookingId],
    );
    expect(failed.rows[0]?.status).toBe("failed");
  });

  it("rejects invalid state transitions without changing another row", async () => {
    const repository = new PostgresBookingRepository(pool);
    const tenantId = await createTenant();
    const first = await repository.reserveBooking(reservation(tenantId));
    await repository.failBooking(first.bookingId);

    await expect(
      repository.confirmBooking({
        bookingId: first.bookingId,
        googleEventId: "late-event",
      }),
    ).rejects.toThrow("Booking state transition failed.");
    await expect(repository.failBooking(randomUUID())).resolves.toBeUndefined();
  });
});
