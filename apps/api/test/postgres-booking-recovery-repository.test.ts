import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PostgresBookingRepository } from "../src/booking/postgres-booking-repository.js";
import { loadEnvironmentFile, readConfig } from "../src/config.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdSlugs: string[] = [];

async function createPendingFixture(updatedAt: Date) {
  const slug = `booking-recovery-${randomUUID()}`;
  createdSlugs.push(slug);
  const tenant = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('Booking recovery test', $1) RETURNING id`,
    [slug],
  );
  const tenantId = tenant.rows[0]?.id;
  if (!tenantId) throw new Error("Recovery tenant was not created.");
  await pool.query(
    `INSERT INTO google_calendar_connections (
       tenant_id, google_subject, google_account_email, calendar_id,
       refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
       encryption_key_version, granted_scopes
     ) VALUES ($1, 'subject', 'owner@example.com', 'primary',
       'ciphertext', 'abcdefghijklmnop', 'abcdefghijklmnopqrstuv', 2,
       ARRAY['calendar.events'])`,
    [tenantId],
  );
  const booking = await pool.query<{ id: string }>(
    `INSERT INTO bookings (
       tenant_id, idempotency_key, attendee_name, attendee_email,
       starts_at, ends_at, status, updated_at
     ) VALUES ($1, $2, 'Ada Lovelace', 'visitor@example.com',
       '2026-09-07T14:30:00.000Z', '2026-09-07T15:00:00.000Z',
       'pending', $3)
     RETURNING id`,
    [tenantId, randomUUID(), updatedAt],
  );
  const bookingId = booking.rows[0]?.id;
  if (!bookingId) throw new Error("Recovery booking was not created.");
  return { bookingId, tenantId };
}

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterEach(async () => {
  await pool.query("DELETE FROM tenants WHERE slug = ANY($1::text[])", [createdSlugs]);
  createdSlugs.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe.sequential("PostgresBookingRepository recovery", () => {
  it("atomically leases one stale pending booking to only one concurrent worker", async () => {
    const repository = new PostgresBookingRepository(pool);
    const fixture = await createPendingFixture(new Date("2026-09-07T11:00:00.000Z"));
    const input = {
      claimedAt: new Date("2026-09-07T12:00:00.000Z"),
      limit: 10,
      staleBefore: new Date("2026-09-07T11:55:00.000Z"),
    };

    const claims = await Promise.all([
      repository.claimPendingBookings(input),
      repository.claimPendingBookings(input),
    ]);

    expect(claims.flat()).toEqual([
      {
        attendeeEmail: "visitor@example.com",
        bookingId: fixture.bookingId,
        calendarId: "primary",
        endAt: new Date("2026-09-07T15:00:00.000Z"),
        refreshToken: {
          authTag: "abcdefghijklmnopqrstuv",
          ciphertext: "ciphertext",
          iv: "abcdefghijklmnop",
          keyVersion: 2,
        },
        startAt: new Date("2026-09-07T14:30:00.000Z"),
        tenantId: fixture.tenantId,
      },
    ]);
    const stored = await pool.query<{ updated_at: Date }>(
      "SELECT updated_at FROM bookings WHERE id = $1",
      [fixture.bookingId],
    );
    expect(stored.rows[0]?.updated_at).toEqual(input.claimedAt);
  });

  it("does not claim a recent pending booking before its retry lease expires", async () => {
    const repository = new PostgresBookingRepository(pool);
    await createPendingFixture(new Date("2026-09-07T11:59:30.000Z"));

    await expect(
      repository.claimPendingBookings({
        claimedAt: new Date("2026-09-07T12:00:00.000Z"),
        limit: 10,
        staleBefore: new Date("2026-09-07T11:55:00.000Z"),
      }),
    ).resolves.toEqual([]);
  });
});
