import type { Pool } from "pg";
import type {
  PublicAvailabilityRepository,
  PublicAvailabilitySource,
} from "./public-availability-service.js";

interface PublicAvailabilityRow {
  booking_window_days: number;
  calendar_id: string;
  encryption_key_version: number;
  end_minute: number | null;
  granted_scopes: string[];
  minimum_notice_minutes: number;
  refresh_token_auth_tag: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  slot_duration_minutes: number;
  start_minute: number | null;
  tenant_id: string;
  time_zone: string;
  weekday: number | null;
}

export class PostgresPublicAvailabilityRepository
  implements PublicAvailabilityRepository
{
  constructor(private readonly pool: Pool) {}

  async findSourceBySlug(
    slug: string,
  ): Promise<PublicAvailabilitySource | null> {
    const result = await this.pool.query<PublicAvailabilityRow>(
      `SELECT tenant.id AS tenant_id,
              policy.time_zone, policy.slot_duration_minutes,
              policy.minimum_notice_minutes, policy.booking_window_days,
              connection.calendar_id, connection.granted_scopes,
              connection.refresh_token_ciphertext,
              connection.refresh_token_iv,
              connection.refresh_token_auth_tag,
              connection.encryption_key_version,
              availability_window.weekday,
              availability_window.start_minute,
              availability_window.end_minute
         FROM tenants AS tenant
         JOIN availability_policies AS policy
           ON policy.tenant_id = tenant.id
         JOIN google_calendar_connections AS connection
           ON connection.tenant_id = tenant.id
         LEFT JOIN weekly_availability_windows AS availability_window
           ON availability_window.tenant_id = tenant.id
        WHERE tenant.slug = $1
        ORDER BY availability_window.weekday,
                 availability_window.start_minute,
                 availability_window.end_minute`,
      [slug],
    );
    const source = result.rows[0];
    if (!source) return null;

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
      calendarId: source.calendar_id,
      grantedScopes: source.granted_scopes,
      policy: {
        bookingWindowDays: source.booking_window_days,
        minimumNoticeMinutes: source.minimum_notice_minutes,
        slotDurationMinutes: source.slot_duration_minutes,
        timeZone: source.time_zone,
        windows,
      },
      refreshToken: {
        authTag: source.refresh_token_auth_tag,
        ciphertext: source.refresh_token_ciphertext,
        iv: source.refresh_token_iv,
        keyVersion: source.encryption_key_version,
      },
      tenantId: source.tenant_id,
    };
  }
}
