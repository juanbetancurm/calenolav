import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
let client: PoolClient | undefined;

async function createTenant(): Promise<string> {
  if (!client) throw new Error("Test client is not available.");
  const tenantId = randomUUID();
  await client.query(
    "INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)",
    [tenantId, "Availability schema test", `availability-schema-${tenantId}`],
  );
  return tenantId;
}

async function insertPolicy(tenantId: string): Promise<void> {
  if (!client) throw new Error("Test client is not available.");
  await client.query(
    `INSERT INTO availability_policies (
       tenant_id, time_zone, slot_duration_minutes,
       minimum_notice_minutes, booking_window_days
     ) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, "America/Bogota", 30, 120, 60],
  );
}

describe.sequential("availability schema", () => {
  beforeAll(async () => {
    client = await pool.connect();
  });

  beforeEach(async () => {
    await client?.query("BEGIN");
  });

  afterEach(async () => {
    await client?.query("ROLLBACK").catch(() => undefined);
  });

  afterAll(async () => {
    client?.release();
    await pool.end();
  });

  it("stores one tenant policy with multiple weekly windows", async () => {
    const tenantId = await createTenant();
    await insertPolicy(tenantId);
    await client?.query(
      `INSERT INTO weekly_availability_windows (
         tenant_id, weekday, start_minute, end_minute
       ) VALUES ($1, 1, 540, 720), ($1, 1, 780, 1020)`,
      [tenantId],
    );

    const policy = await client?.query<{
      booking_window_days: number;
      minimum_notice_minutes: number;
      slot_duration_minutes: number;
      time_zone: string;
    }>(
      `SELECT time_zone, slot_duration_minutes,
              minimum_notice_minutes, booking_window_days
         FROM availability_policies
        WHERE tenant_id = $1`,
      [tenantId],
    );
    const windows = await client?.query<{
      end_minute: number;
      start_minute: number;
      weekday: number;
    }>(
      `SELECT weekday, start_minute, end_minute
         FROM weekly_availability_windows
        WHERE tenant_id = $1
        ORDER BY weekday, start_minute`,
      [tenantId],
    );

    expect(policy?.rows).toEqual([
      {
        booking_window_days: 60,
        minimum_notice_minutes: 120,
        slot_duration_minutes: 30,
        time_zone: "America/Bogota",
      },
    ]);
    expect(windows?.rows).toEqual([
      { end_minute: 720, start_minute: 540, weekday: 1 },
      { end_minute: 1020, start_minute: 780, weekday: 1 },
    ]);
  });

  it("rejects policy values outside the supported scheduling limits", async () => {
    const tenantId = await createTenant();

    await expect(
      client?.query(
        `INSERT INTO availability_policies (
           tenant_id, time_zone, slot_duration_minutes,
           minimum_notice_minutes, booking_window_days
         ) VALUES ($1, 'America/Bogota', 7, 120, 60)`,
        [tenantId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects malformed windows and windows without a tenant policy", async () => {
    const malformedTenantId = await createTenant();
    await insertPolicy(malformedTenantId);
    await expect(
      client?.query(
        `INSERT INTO weekly_availability_windows (
           tenant_id, weekday, start_minute, end_minute
         ) VALUES ($1, 0, 540, 720)`,
        [malformedTenantId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await client?.query("ROLLBACK");
    await client?.query("BEGIN");
    const missingPolicyTenantId = await createTenant();
    await expect(
      client?.query(
        `INSERT INTO weekly_availability_windows (
           tenant_id, weekday, start_minute, end_minute
         ) VALUES ($1, 1, 540, 720)`,
        [missingPolicyTenantId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("removes the policy and windows when the tenant is deleted", async () => {
    const tenantId = await createTenant();
    await insertPolicy(tenantId);
    await client?.query(
      `INSERT INTO weekly_availability_windows (
         tenant_id, weekday, start_minute, end_minute
       ) VALUES ($1, 2, 600, 900)`,
      [tenantId],
    );

    await client?.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    const counts = await client?.query<{ policies: string; windows: string }>(
      `SELECT
         (SELECT count(*)::text FROM availability_policies WHERE tenant_id = $1) AS policies,
         (SELECT count(*)::text FROM weekly_availability_windows WHERE tenant_id = $1) AS windows`,
      [tenantId],
    );

    expect(counts?.rows).toEqual([{ policies: "0", windows: "0" }]);
  });
});
