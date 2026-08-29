import type { Pool, PoolClient } from "pg";
import type { AvailabilityPolicyRepository } from "./policy-services.js";
import type { AvailabilityPolicy } from "./weekly-policy.js";

interface AvailabilityPolicyRow {
  booking_window_days: number;
  end_minute: number | null;
  minimum_notice_minutes: number;
  slot_duration_minutes: number;
  start_minute: number | null;
  time_zone: string;
  weekday: number | null;
}

async function replacePolicyTransaction(
  client: PoolClient,
  tenantId: string,
  policy: AvailabilityPolicy,
): Promise<void> {
  await client.query(
    `INSERT INTO availability_policies (
       tenant_id, time_zone, slot_duration_minutes,
       minimum_notice_minutes, booking_window_days
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id) DO UPDATE SET
       time_zone = EXCLUDED.time_zone,
       slot_duration_minutes = EXCLUDED.slot_duration_minutes,
       minimum_notice_minutes = EXCLUDED.minimum_notice_minutes,
       booking_window_days = EXCLUDED.booking_window_days,
       updated_at = now()`,
    [
      tenantId,
      policy.timeZone,
      policy.slotDurationMinutes,
      policy.minimumNoticeMinutes,
      policy.bookingWindowDays,
    ],
  );
  await client.query(
    "DELETE FROM weekly_availability_windows WHERE tenant_id = $1",
    [tenantId],
  );

  for (const window of policy.windows) {
    await client.query(
      `INSERT INTO weekly_availability_windows (
         tenant_id, weekday, start_minute, end_minute
       ) VALUES ($1, $2, $3, $4)`,
      [tenantId, window.weekday, window.startMinute, window.endMinute],
    );
  }
}

export class PostgresAvailabilityPolicyRepository
  implements AvailabilityPolicyRepository
{
  constructor(private readonly pool: Pool) {}

  async findPolicy(tenantId: string): Promise<AvailabilityPolicy | null> {
    const result = await this.pool.query<AvailabilityPolicyRow>(
      `SELECT policy.time_zone, policy.slot_duration_minutes,
              policy.minimum_notice_minutes, policy.booking_window_days,
              availability_window.weekday,
              availability_window.start_minute,
              availability_window.end_minute
         FROM availability_policies AS policy
         LEFT JOIN weekly_availability_windows AS availability_window
           ON availability_window.tenant_id = policy.tenant_id
        WHERE policy.tenant_id = $1
        ORDER BY availability_window.weekday,
                 availability_window.start_minute,
                 availability_window.end_minute`,
      [tenantId],
    );
    const policyRow = result.rows[0];
    if (!policyRow) return null;

    const windows = result.rows.flatMap((row) =>
      row.weekday === null || row.start_minute === null || row.end_minute === null
        ? []
        : [
            {
              endMinute: row.end_minute,
              startMinute: row.start_minute,
              weekday: row.weekday,
            },
          ],
    );

    return {
      bookingWindowDays: policyRow.booking_window_days,
      minimumNoticeMinutes: policyRow.minimum_notice_minutes,
      slotDurationMinutes: policyRow.slot_duration_minutes,
      timeZone: policyRow.time_zone,
      windows,
    };
  }

  async replacePolicy(
    tenantId: string,
    policy: AvailabilityPolicy,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await replacePolicyTransaction(client, tenantId, policy);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}