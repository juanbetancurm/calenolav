import type { Pool } from "pg";
import type {
  GoogleCalendarConnectionManagementRepository,
  GoogleCalendarConnectionStatusRecord,
} from "./connection-services.js";

interface GoogleCalendarConnectionStatusRow {
  calendar_id: string;
  connected_at: Date;
  google_account_email: string;
  granted_scopes: string[];
  updated_at: Date;
}

export class PostgresGoogleCalendarConnectionManagementRepository
  implements GoogleCalendarConnectionManagementRepository
{
  constructor(private readonly pool: Pool) {}

  async findConnectionStatus(
    tenantId: string,
  ): Promise<GoogleCalendarConnectionStatusRecord | null> {
    const result = await this.pool.query<GoogleCalendarConnectionStatusRow>(
      `SELECT google_account_email, calendar_id, granted_scopes,
              connected_at, updated_at
         FROM google_calendar_connections
        WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      calendarId: row.calendar_id,
      connectedAt: row.connected_at,
      googleAccountEmail: row.google_account_email,
      grantedScopes: row.granted_scopes,
      updatedAt: row.updated_at,
    };
  }

  async deleteConnection(tenantId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM google_calendar_connections WHERE tenant_id = $1",
      [tenantId],
    );
  }
}
