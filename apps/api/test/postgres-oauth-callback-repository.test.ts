import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";
import { PostgresGoogleOAuthCallbackRepository } from "../src/google/postgres-oauth-callback-repository.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdEmails: string[] = [];
const createdSlugs: string[] = [];

async function createOwnerFixture() {
  const suffix = randomUUID();
  const email = `oauth-callback-${suffix}@example.com`;
  const slug = `oauth-callback-${suffix}`;
  createdEmails.push(email);
  createdSlugs.push(slug);

  const result = await pool.query<{ tenant_id: string; user_id: string }>(
    `WITH new_user AS (
       INSERT INTO users (email, password_hash)
       VALUES ($1, 'not-a-real-password-hash')
       RETURNING id
     ), new_tenant AS (
       INSERT INTO tenants (name, slug)
       VALUES ('OAuth Callback Test', $2)
       RETURNING id
     ), new_membership AS (
       INSERT INTO tenant_memberships (tenant_id, user_id, role)
       SELECT new_tenant.id, new_user.id, 'owner'
       FROM new_tenant, new_user
     )
     SELECT new_user.id AS user_id, new_tenant.id AS tenant_id
     FROM new_user, new_tenant`,
    [email, slug],
  );
  const row = result.rows[0];
  if (!row) throw new Error("OAuth callback owner fixture was not created.");
  return row;
}

async function insertAttempt(input: {
  expiresAt: Date;
  stateHash: string;
  tenantId: string;
  userId: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO google_oauth_attempts (
       state_hash, tenant_id, user_id, code_verifier_ciphertext,
       code_verifier_iv, code_verifier_auth_tag,
       encryption_key_version, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.stateHash,
      input.tenantId,
      input.userId,
      "encrypted-code-verifier",
      "AQIDBAUGBwgJCgsM",
      "DQ4PEBESExQVFhcYGRobHA",
      2,
      input.expiresAt,
    ],
  );
}

beforeAll(async () => {
  await pool.query("select 1");
});

afterEach(async () => {
  await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [createdEmails]);
  await pool.query("DELETE FROM tenants WHERE slug = ANY($1::text[])", [createdSlugs]);
  createdEmails.length = 0;
  createdSlugs.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe.sequential("PostgresGoogleOAuthCallbackRepository", () => {
  it("atomically returns an authorization attempt to only one concurrent consumer", async () => {
    const repository = new PostgresGoogleOAuthCallbackRepository(pool);
    const fixture = await createOwnerFixture();
    const stateHash = "e".repeat(64);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    await insertAttempt({
      expiresAt,
      stateHash,
      tenantId: fixture.tenant_id,
      userId: fixture.user_id,
    });

    const results = await Promise.all([
      repository.consumeAttempt(stateHash),
      repository.consumeAttempt(stateHash),
    ]);

    expect(results.filter((result) => result !== null)).toEqual([
      {
        codeVerifier: {
          authTag: "DQ4PEBESExQVFhcYGRobHA",
          ciphertext: "encrypted-code-verifier",
          iv: "AQIDBAUGBwgJCgsM",
          keyVersion: 2,
        },
        expiresAt,
        stateHash,
        tenantId: fixture.tenant_id,
        userId: fixture.user_id,
      },
    ]);
    expect(results.filter((result) => result === null)).toHaveLength(1);

    const remaining = await pool.query<{ count: string }>(
      "SELECT count(*) FROM google_oauth_attempts WHERE state_hash = $1",
      [stateHash],
    );
    expect(remaining.rows[0]?.count).toBe("0");
  });

  it("persists the encrypted refresh-token envelope and granted scopes", async () => {
    const repository = new PostgresGoogleOAuthCallbackRepository(pool);
    const fixture = await createOwnerFixture();

    await repository.saveConnection({
      calendarId: "primary",
      googleAccountEmail: "owner@example.com",
      googleSubject: "google-subject-123",
      grantedScopes: ["scope-a", "scope-b"],
      refreshToken: {
        authTag: "HBsaGRgXFhUUExIREA8ODQ",
        ciphertext: "encrypted-refresh-token",
        iv: "DAoJCAcGBQQDAgEA",
        keyVersion: 3,
      },
      tenantId: fixture.tenant_id,
    });

    const result = await pool.query<{
      calendar_id: string;
      encryption_key_version: number;
      google_account_email: string;
      google_subject: string;
      granted_scopes: string[];
      refresh_token_auth_tag: string;
      refresh_token_ciphertext: string;
      refresh_token_iv: string;
      tenant_id: string;
    }>(
      `SELECT tenant_id, google_subject, google_account_email, calendar_id,
              refresh_token_ciphertext, refresh_token_iv,
              refresh_token_auth_tag, encryption_key_version, granted_scopes
         FROM google_calendar_connections
        WHERE tenant_id = $1`,
      [fixture.tenant_id],
    );

    expect(result.rows).toEqual([
      {
        calendar_id: "primary",
        encryption_key_version: 3,
        google_account_email: "owner@example.com",
        google_subject: "google-subject-123",
        granted_scopes: ["scope-a", "scope-b"],
        refresh_token_auth_tag: "HBsaGRgXFhUUExIREA8ODQ",
        refresh_token_ciphertext: "encrypted-refresh-token",
        refresh_token_iv: "DAoJCAcGBQQDAgEA",
        tenant_id: fixture.tenant_id,
      },
    ]);
    expect(JSON.stringify(result.rows)).not.toContain("raw-refresh-token");
  });

  it("replaces one tenant connection without duplicating its original connection time", async () => {
    const repository = new PostgresGoogleOAuthCallbackRepository(pool);
    const fixture = await createOwnerFixture();
    const originalConnectedAt = new Date("2026-08-18T10:00:00.000Z");
    await pool.query(
      `INSERT INTO google_calendar_connections (
         tenant_id, google_subject, google_account_email, calendar_id,
         refresh_token_ciphertext, refresh_token_iv,
         refresh_token_auth_tag, encryption_key_version, granted_scopes,
         connected_at, updated_at
       ) VALUES ($1, 'old-subject', 'old@example.com', 'old-calendar',
                 'old-ciphertext', 'AQIDBAUGBwgJCgsM',
                 'DQ4PEBESExQVFhcYGRobHA', 1, ARRAY['old-scope'], $2, $2)`,
      [fixture.tenant_id, originalConnectedAt],
    );

    await repository.saveConnection({
      calendarId: "primary",
      googleAccountEmail: "new@example.com",
      googleSubject: "new-subject",
      grantedScopes: ["new-scope"],
      refreshToken: {
        authTag: "HBsaGRgXFhUUExIREA8ODQ",
        ciphertext: "new-ciphertext",
        iv: "DAoJCAcGBQQDAgEA",
        keyVersion: 4,
      },
      tenantId: fixture.tenant_id,
    });

    const result = await pool.query<{
      connected_at: Date;
      count: string;
      google_subject: string;
      refresh_token_ciphertext: string;
      updated_at: Date;
    }>(
      `SELECT count(*) OVER ()::text AS count, google_subject,
              refresh_token_ciphertext, connected_at, updated_at
         FROM google_calendar_connections
        WHERE tenant_id = $1`,
      [fixture.tenant_id],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      connected_at: originalConnectedAt,
      count: "1",
      google_subject: "new-subject",
      refresh_token_ciphertext: "new-ciphertext",
    });
    expect(result.rows[0]?.updated_at.getTime()).toBeGreaterThan(
      originalConnectedAt.getTime(),
    );
  });
});
