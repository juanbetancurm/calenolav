import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";
import { PostgresSessionRepository } from "../src/auth/postgres-session-repository.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdEmails: string[] = [];

async function createOwnerFixture() {
  const suffix = randomUUID();
  const email = `session-${suffix}@example.com`;
  const slug = `session-${suffix}`;
  createdEmails.push(email);

  const result = await pool.query<{ tenant_id: string; user_id: string }>(
    `WITH new_user AS (
       INSERT INTO users (email, password_hash, locale)
       VALUES ($1, $2, 'es')
       RETURNING id
     ), new_tenant AS (
       INSERT INTO tenants (name, slug)
       VALUES ('Session Test', $3)
       RETURNING id
     ), new_membership AS (
       INSERT INTO tenant_memberships (tenant_id, user_id, role)
       SELECT new_tenant.id, new_user.id, 'owner'
       FROM new_tenant, new_user
     )
     SELECT new_user.id AS user_id, new_tenant.id AS tenant_id
     FROM new_user, new_tenant`,
    [email, "scrypt$fixture-password-hash", slug],
  );

  const row = result.rows[0];
  if (!row) throw new Error("Owner fixture was not created.");
  return { email, passwordHash: "scrypt$fixture-password-hash", ...row };
}

beforeAll(async () => {
  await pool.query("select 1");
});

afterEach(async () => {
  await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [createdEmails]);
  createdEmails.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe.sequential("PostgresSessionRepository", () => {
  it("finds normalized credentials without returning tenant or session data", async () => {
    const repository = new PostgresSessionRepository(pool);
    const fixture = await createOwnerFixture();

    const credentials = await repository.findUserCredentialsByEmail(fixture.email);

    expect(credentials).toEqual({
      email: fixture.email,
      passwordHash: fixture.passwordHash,
      userId: fixture.user_id,
    });
    expect(await repository.findUserCredentialsByEmail("missing@example.com")).toBeNull();
  });

  it("creates a hashed session and loads its tenant-aware principal", async () => {
    const repository = new PostgresSessionRepository(pool);
    const fixture = await createOwnerFixture();
    const rawToken = "repository-session-token";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date("2026-09-12T12:00:00.000Z");

    await repository.createSession({ expiresAt, tokenHash, userId: fixture.user_id });
    const stored = await repository.findSessionByTokenHash(tokenHash);

    expect(stored).toMatchObject({
      email: fixture.email,
      expiresAt,
      memberships: [{ role: "owner", tenantId: fixture.tenant_id }],
      revokedAt: null,
      userId: fixture.user_id,
    });
    expect(JSON.stringify(stored)).not.toContain(rawToken);
  });

  it("updates last use and revokes a session idempotently", async () => {
    const repository = new PostgresSessionRepository(pool);
    const fixture = await createOwnerFixture();
    const tokenHash = "d".repeat(64);
    await repository.createSession({
      expiresAt: new Date("2026-09-12T12:00:00.000Z"),
      tokenHash,
      userId: fixture.user_id,
    });
    const stored = await repository.findSessionByTokenHash(tokenHash);
    if (!stored) throw new Error("Session fixture was not created.");
    const lastSeenAt = new Date("2026-08-12T15:00:00.000Z");
    const revokedAt = new Date("2026-08-12T15:01:00.000Z");

    await repository.touchSession(stored.sessionId, lastSeenAt);
    await repository.revokeSessionByTokenHash(tokenHash, revokedAt);
    await repository.revokeSessionByTokenHash(tokenHash, new Date("2026-08-12T16:00:00.000Z"));

    const persisted = await pool.query<{ last_seen_at: Date; revoked_at: Date }>(
      "SELECT last_seen_at, revoked_at FROM sessions WHERE id = $1",
      [stored.sessionId],
    );
    expect(persisted.rows[0]).toEqual({ last_seen_at: lastSeenAt, revoked_at: revokedAt });
  });
});
