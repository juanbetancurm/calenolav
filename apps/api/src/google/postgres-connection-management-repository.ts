import type { Pool } from "pg";
import type {
  GoogleCalendarConnectionManagementRepository,
  GoogleCalendarConnectionStatusRecord,
} from "./connection-services.js";
import type { EncryptedSecret } from "./secret-box.js";

interface GoogleCalendarConnectionStatusRow {
  calendar_id: string;
  connected_at: Date;
  google_account_email: string;
  granted_scopes: string[];
  updated_at: Date;
}

interface GoogleCalendarCredentialRow {
  encryption_key_version: number;
  refresh_token_auth_tag: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
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

  async takeConnectionForDisconnect(
    tenantId: string,
  ): Promise<{ refreshToken: EncryptedSecret } | null> {
    const result = await this.pool.query<GoogleCalendarCredentialRow>(
      `DELETE FROM google_calendar_connections
        WHERE tenant_id = $1
      RETURNING refresh_token_ciphertext, refresh_token_iv,
                refresh_token_auth_tag, encryption_key_version`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      refreshToken: {
        authTag: row.refresh_token_auth_tag,
        ciphertext: row.refresh_token_ciphertext,
        iv: row.refresh_token_iv,
        keyVersion: row.encryption_key_version,
      },
    };
  }
}
