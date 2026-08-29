import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdSlugs: string[] = [];

async function createTenant(): Promise<string> {
  const slug = `booking-schema-${randomUUID()}`;
  createdSlugs.push(slug);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, slug)
     VALUES ('Booking schema test', $1)
     RETURNING id`,
    [slug],
  );
  const tenantId = result.rows[0]?.id;
  if (!tenantId) throw new Error("Booking schema tenant was not created.");
  return tenantId;
}

async function insertBooking(input: {
  attendeeEmail?: string;
  attendeeName?: string;
  endAt?: string;
  googleEventId?: string | null;
  idempotencyKey?: string;
  startAt?: string;
  status?: "confirmed" | "failed" | "pending";
  tenantId: string;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO bookings (
       tenant_id, idempotency_key, attendee_name, attendee_email,
       starts_at, ends_at, status, google_event_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.tenantId,
      input.idempotencyKey ?? randomUUID(),
      input.attendeeName ?? "Ada Lovelace",
      input.attendeeEmail ?? "visitor@example.com",
      input.startAt ?? "2026-09-07T14:30:00.000Z",
      input.endAt ?? "2026-09-07T15:00:00.000Z",
      input.status ?? "pending",
      input.googleEventId ?? null,
    ],
  );
  const bookingId = result.rows[0]?.id;
  if (!bookingId) throw new Error("Booking was not created.");
  return bookingId;
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

describe.sequential("booking schema", () => {
  it("stores the minimum pending reservation data for one tenant", async () => {
    const tenantId = await createTenant();
    const idempotencyKey = randomUUID();
    const bookingId = await insertBooking({ idempotencyKey, tenantId });

    const result = await pool.query(
      `SELECT tenant_id, idempotency_key, attendee_name, attendee_email,
              starts_at, ends_at, status, google_event_id
         FROM bookings
        WHERE id = $1`,
      [bookingId],
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        attendee_email: "visitor@example.com",
        attendee_name: "Ada Lovelace",
        google_event_id: null,
        idempotency_key: idempotencyKey,
        status: "pending",
        tenant_id: tenantId,
      }),
    ]);
  });

  it("scopes idempotency keys to one tenant", async () => {
    const firstTenantId = await createTenant();
    const secondTenantId = await createTenant();
    const idempotencyKey = randomUUID();
    await insertBooking({ idempotencyKey, tenantId: firstTenantId });

    await expect(
      insertBooking({ idempotencyKey, tenantId: firstTenantId }),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      insertBooking({ idempotencyKey, tenantId: secondTenantId }),
    ).resolves.toEqual(expect.any(String));
  });

  it("rejects overlapping active reservations while allowing safe boundaries", async () => {
    const selectedTenantId = await createTenant();
    const otherTenantId = await createTenant();
    await insertBooking({ tenantId: selectedTenantId });

    await expect(
      insertBooking({
        endAt: "2026-09-07T15:15:00.000Z",
        startAt: "2026-09-07T14:45:00.000Z",
        status: "confirmed",
        googleEventId: "google-event-overlap",
        tenantId: selectedTenantId,
      }),
    ).rejects.toMatchObject({ code: "23P01" });
    await expect(
      insertBooking({
        endAt: "2026-09-07T15:30:00.000Z",
        startAt: "2026-09-07T15:00:00.000Z",
        tenantId: selectedTenantId,
      }),
    ).resolves.toEqual(expect.any(String));
    await expect(
      insertBooking({ status: "failed", tenantId: selectedTenantId }),
    ).resolves.toEqual(expect.any(String));
    await expect(
      insertBooking({ tenantId: otherTenantId }),
    ).resolves.toEqual(expect.any(String));
  });

  it("enforces interval, attendee, and confirmed-event invariants", async () => {
    const tenantId = await createTenant();

    for (const invalid of [
      { attendeeName: " " },
      { attendeeEmail: "bad" },
      { endAt: "2026-09-07T14:30:00.000Z" },
      { status: "confirmed" as const },
      { googleEventId: "unexpected-event" },
    ]) {
      await expect(
        insertBooking({ tenantId, ...invalid }),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("removes tenant bookings by cascade", async () => {
    const tenantId = await createTenant();
    await insertBooking({ tenantId });

    await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    const result = await pool.query<{ count: string }>(
      "SELECT count(*) FROM bookings WHERE tenant_id = $1",
      [tenantId],
    );

    expect(result.rows[0]?.count).toBe("0");
  });
});
