import type { Pool } from "pg";
import type {
  ConsumedGoogleOAuthAttempt,
  GoogleOAuthCallbackRepository,
  NewGoogleCalendarConnection,
} from "./oauth-callback.js";

interface OAuthAttemptRow {
  code_verifier_auth_tag: string;
  code_verifier_ciphertext: string;
  code_verifier_iv: string;
  encryption_key_version: number;
  expires_at: Date;
  state_hash: string;
  tenant_id: string;
  user_id: string;
}

export class PostgresGoogleOAuthCallbackRepository
  implements GoogleOAuthCallbackRepository
{
  constructor(private readonly pool: Pool) {}

  async consumeAttempt(
    stateHash: string,
  ): Promise<ConsumedGoogleOAuthAttempt | null> {
    const result = await this.pool.query<OAuthAttemptRow>(
      `DELETE FROM google_oauth_attempts
        WHERE state_hash = $1
      RETURNING state_hash, tenant_id, user_id,
                code_verifier_ciphertext, code_verifier_iv,
                code_verifier_auth_tag, encryption_key_version, expires_at`,
      [stateHash],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      codeVerifier: {
        authTag: row.code_verifier_auth_tag,
        ciphertext: row.code_verifier_ciphertext,
        iv: row.code_verifier_iv,
        keyVersion: row.encryption_key_version,
      },
      expiresAt: row.expires_at,
      stateHash: row.state_hash,
      tenantId: row.tenant_id,
      userId: row.user_id,
    };
  }

  async saveConnection(connection: NewGoogleCalendarConnection): Promise<void> {
    await this.pool.query(
      `INSERT INTO google_calendar_connections (
         tenant_id,
         google_subject,
         google_account_email,
         calendar_id,
         refresh_token_ciphertext,
         refresh_token_iv,
         refresh_token_auth_tag,
         encryption_key_version,
         granted_scopes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET
         google_subject = EXCLUDED.google_subject,
         google_account_email = EXCLUDED.google_account_email,
         calendar_id = EXCLUDED.calendar_id,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         refresh_token_iv = EXCLUDED.refresh_token_iv,
         refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
         encryption_key_version = EXCLUDED.encryption_key_version,
         granted_scopes = EXCLUDED.granted_scopes,
         updated_at = now()`,
      [
        connection.tenantId,
        connection.googleSubject,
        connection.googleAccountEmail,
        connection.calendarId,
        connection.refreshToken.ciphertext,
        connection.refreshToken.iv,
        connection.refreshToken.authTag,
        connection.refreshToken.keyVersion,
        connection.grantedScopes,
      ],
    );
  }
}
