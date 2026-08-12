import type { Pool } from "pg";
import type {
  NewSessionRecord,
  SessionRepository,
  StoredSession,
  TenantMembership,
  UserCredentials,
} from "./session-services.js";

interface StoredSessionRow {
  email: string;
  expires_at: Date;
  revoked_at: Date | null;
  role: "member" | "owner" | null;
  session_id: string;
  tenant_id: string | null;
  user_id: string;
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async findUserCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const result = await this.pool.query<{
      email: string;
      id: string;
      password_hash: string;
    }>(
      `SELECT id, email, password_hash
         FROM users
        WHERE lower(email) = lower($1)
        LIMIT 1`,
      [email],
    );
    const row = result.rows[0];
    return row
      ? { email: row.email, passwordHash: row.password_hash, userId: row.id }
      : null;
  }

  async createSession(session: NewSessionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [session.userId, session.tokenHash, session.expiresAt],
    );
  }

  async findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const result = await this.pool.query<StoredSessionRow>(
      `SELECT s.id AS session_id,
              s.expires_at,
              s.revoked_at,
              u.id AS user_id,
              u.email,
              tm.tenant_id,
              tm.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN tenant_memberships tm ON tm.user_id = u.id
        WHERE s.token_hash = $1
        ORDER BY tm.tenant_id`,
      [tokenHash],
    );
    const first = result.rows[0];
    if (!first) return null;

    const memberships: TenantMembership[] = result.rows.flatMap((row) =>
      row.tenant_id && row.role
        ? [{ role: row.role, tenantId: row.tenant_id }]
        : [],
    );

    return {
      email: first.email,
      expiresAt: first.expires_at,
      memberships,
      revokedAt: first.revoked_at,
      sessionId: first.session_id,
      userId: first.user_id,
    };
  }

  async touchSession(sessionId: string, lastSeenAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE sessions
          SET last_seen_at = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, lastSeenAt],
    );
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, $2)
        WHERE token_hash = $1`,
      [tokenHash, revokedAt],
    );
  }
}
