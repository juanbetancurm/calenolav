import type { Pool } from "pg";
import type {
  GoogleOAuthAttemptRepository,
  NewGoogleOAuthAttempt,
} from "./oauth-authorization.js";

export class PostgresGoogleOAuthAttemptRepository
  implements GoogleOAuthAttemptRepository
{
  constructor(private readonly pool: Pool) {}

  async createAttempt(attempt: NewGoogleOAuthAttempt): Promise<void> {
    await this.pool.query(
      `INSERT INTO google_oauth_attempts (
         state_hash,
         tenant_id,
         user_id,
         code_verifier_ciphertext,
         code_verifier_iv,
         code_verifier_auth_tag,
         encryption_key_version,
         expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        attempt.stateHash,
        attempt.tenantId,
        attempt.userId,
        attempt.codeVerifier.ciphertext,
        attempt.codeVerifier.iv,
        attempt.codeVerifier.authTag,
        attempt.codeVerifier.keyVersion,
        attempt.expiresAt,
      ],
    );
  }
}
