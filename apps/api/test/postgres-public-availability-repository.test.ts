import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";
import { PostgresPublicAvailabilityRepository } from "../src/availability/postgres-public-availability-repository.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdSlugs: string[] = [];
const freeBusyScope = "https://www.googleapis.com/auth/calendar.freebusy";

async function createTenantFixture(): Promise<{ slug: string; tenantId: string }> {
  const slug = `public-availability-${randomUUID()}`;
  createdSlugs.push(slug);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, slug)
     VALUES ('Public availability test', $1)
     RETURNING id`,
    [slug],
  );
  const tenantId = result.rows[0]?.id;
  if (!tenantId) throw new Error("Public availability tenant was not created.");
  return { slug, tenantId };
}

async function insertPolicy(tenantId: string): Promise<void> {
  await pool.query(
    `INSERT INTO availability_policies (
       tenant_id, time_zone, slot_duration_minutes,
       minimum_notice_minutes, booking_window_days
     ) VALUES ($1, 'America/Bogota', 30, 120, 60)`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO weekly_availability_windows (
       tenant_id, weekday, start_minute, end_minute
     ) VALUES ($1, 3, 780, 1020), ($1, 1, 540, 720)`,
    [tenantId],
  );
}

async function insertConnection(tenantId: string): Promise<void> {
  await pool.query(
    `INSERT INTO google_calendar_connections (
       tenant_id, google_subject, google_account_email, calendar_id,
       refresh_token_ciphertext, refresh_token_iv,
       refresh_token_auth_tag, encryption_key_version, granted_scopes
     ) VALUES ($1, 'internal-subject', 'owner@example.com', 'primary',
               'encrypted-refresh-token', 'AQIDBAUGBwgJCgsM',
               'DQ4PEBESExQVFhcYGRobHA', 2, ARRAY[$2])`,
    [tenantId, freeBusyScope],
  );
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

describe.sequential("PostgresPublicAvailabilityRepository", () => {
  it("maps one configured public source with canonical windows", async () => {
    const repository = new PostgresPublicAvailabilityRepository(pool);
    const { slug, tenantId } = await createTenantFixture();
    await insertPolicy(tenantId);
    await insertConnection(tenantId);

    await expect(repository.findSourceBySlug(slug)).resolves.toEqual({
      calendarId: "primary",
      grantedScopes: [freeBusyScope],
      policy: {
        bookingWindowDays: 60,
        minimumNoticeMinutes: 120,
        slotDurationMinutes: 30,
        timeZone: "America/Bogota",
        windows: [
          { endMinute: 720, startMinute: 540, weekday: 1 },
          { endMinute: 1020, startMinute: 780, weekday: 3 },
        ],
      },
      refreshToken: {
        authTag: "DQ4PEBESExQVFhcYGRobHA",
        ciphertext: "encrypted-refresh-token",
        iv: "AQIDBAUGBwgJCgsM",
        keyVersion: 2,
      },
      tenantId,
    });
  });

  it.each(["policy", "connection"] as const)(
    "returns null when the tenant lacks its %s",
    async (missing) => {
      const repository = new PostgresPublicAvailabilityRepository(pool);
      const { slug, tenantId } = await createTenantFixture();
      if (missing !== "policy") await insertPolicy(tenantId);
      if (missing !== "connection") await insertConnection(tenantId);

      await expect(repository.findSourceBySlug(slug)).resolves.toBeNull();
    },
  );

  it("returns null for an unknown public slug", async () => {
    const repository = new PostgresPublicAvailabilityRepository(pool);

    await expect(
      repository.findSourceBySlug("unknown-public-tenant"),
    ).resolves.toBeNull();
  });
});
