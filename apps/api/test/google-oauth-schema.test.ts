import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
let client: PoolClient;

async function createOwnerFixture() {
  const suffix = randomUUID();
  const result = await client.query<{ tenant_id: string; user_id: string }>(
    `WITH new_user AS (
       INSERT INTO users (email, password_hash)
       VALUES ($1, 'not-a-real-password-hash')
       RETURNING id
     ), new_tenant AS (
       INSERT INTO tenants (name, slug)
       VALUES ('Google OAuth Test', $2)
       RETURNING id
     ), new_membership AS (
       INSERT INTO tenant_memberships (tenant_id, user_id, role)
       SELECT new_tenant.id, new_user.id, 'owner'
       FROM new_tenant, new_user
     )
     SELECT new_user.id AS user_id, new_tenant.id AS tenant_id
     FROM new_user, new_tenant`,
    [`google-${suffix}@example.com`, `google-${suffix}`],
  );
  const row = result.rows[0];
  if (!row) throw new Error("OAuth owner fixture was not created.");
  return row;
}

const encryptedRefreshToken = {
  ciphertext: "encrypted-refresh-token-payload",
  iv: "AQIDBAUGBwgJCgsM",
  authTag: "DQ4PEBESExQVFhcYGRobHA",
  keyVersion: 1,
};

beforeAll(async () => {
  client = await pool.connect();
});

beforeEach(async () => {
  await client.query("BEGIN");
});

afterEach(async () => {
  await client.query("ROLLBACK");
});

afterAll(async () => {
  client.release();
  await pool.end();
});

describe.sequential("Google OAuth schema", () => {
  it("stores one encrypted Google Calendar connection per tenant", async () => {
    const fixture = await createOwnerFixture();
    const scopes = [
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events.owned",
    ];

    await client.query(
      `INSERT INTO google_calendar_connections (
         tenant_id, google_subject, google_account_email, calendar_id,
         refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
         encryption_key_version, granted_scopes
       ) VALUES ($1, $2, $3, 'primary', $4, $5, $6, $7, $8)`,
      [
        fixture.tenant_id,
        "google-account-123",
        "calendar-owner@example.com",
        encryptedRefreshToken.ciphertext,
        encryptedRefreshToken.iv,
        encryptedRefreshToken.authTag,
        encryptedRefreshToken.keyVersion,
        scopes,
      ],
    );

    const result = await client.query<{
      calendar_id: string;
      encryption_key_version: number;
      granted_scopes: string[];
      refresh_token_ciphertext: string;
    }>(
      `SELECT calendar_id, encryption_key_version, granted_scopes,
              refresh_token_ciphertext
         FROM google_calendar_connections
        WHERE tenant_id = $1`,
      [fixture.tenant_id],
    );

    expect(result.rows[0]).toEqual({
      calendar_id: "primary",
      encryption_key_version: 1,
      granted_scopes: scopes,
      refresh_token_ciphertext: encryptedRefreshToken.ciphertext,
    });
    expect(JSON.stringify(result.rows[0])).not.toContain("raw-google-refresh-token");
  });

  it("rejects a second Google connection for the same tenant", async () => {
    const fixture = await createOwnerFixture();
    const values = [
      fixture.tenant_id,
      "google-account-123",
      "calendar-owner@example.com",
      encryptedRefreshToken.ciphertext,
      encryptedRefreshToken.iv,
      encryptedRefreshToken.authTag,
      encryptedRefreshToken.keyVersion,
      ["https://www.googleapis.com/auth/calendar.events.freebusy"],
    ];
    const insert = `INSERT INTO google_calendar_connections (
      tenant_id, google_subject, google_account_email, refresh_token_ciphertext,
      refresh_token_iv, refresh_token_auth_tag, encryption_key_version, granted_scopes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

    await client.query(insert, values);
    await expect(client.query(insert, values)).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects malformed authenticated-encryption metadata", async () => {
    const fixture = await createOwnerFixture();

    await expect(
      client.query(
        `INSERT INTO google_calendar_connections (
          tenant_id, google_subject, google_account_email, refresh_token_ciphertext,
          refresh_token_iv, refresh_token_auth_tag, encryption_key_version, granted_scopes
        ) VALUES ($1, 'google-account-123', 'owner@example.com',
                  'ciphertext', 'too-short', $2, 1, ARRAY['calendar-scope'])`,
        [fixture.tenant_id, encryptedRefreshToken.authTag],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a connection for a tenant that does not exist", async () => {
    await expect(
      client.query(
        `INSERT INTO google_calendar_connections (
          tenant_id, google_subject, google_account_email, refresh_token_ciphertext,
          refresh_token_iv, refresh_token_auth_tag, encryption_key_version, granted_scopes
        ) VALUES ($1, 'google-account-123', 'owner@example.com',
                  'ciphertext', $2, $3, 1, ARRAY['calendar-scope'])`,
        [randomUUID(), encryptedRefreshToken.iv, encryptedRefreshToken.authTag],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("stores only a state digest and encrypted PKCE verifier during authorization", async () => {
    const fixture = await createOwnerFixture();
    const rawState = "raw-unpredictable-oauth-state";
    const stateHash = createHash("sha256").update(rawState).digest("hex");

    await client.query(
      `INSERT INTO google_oauth_attempts (
        state_hash, tenant_id, user_id, code_verifier_ciphertext,
        code_verifier_iv, code_verifier_auth_tag, encryption_key_version, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, now() + interval '10 minutes')`,
      [
        stateHash,
        fixture.tenant_id,
        fixture.user_id,
        "encrypted-code-verifier",
        encryptedRefreshToken.iv,
        encryptedRefreshToken.authTag,
      ],
    );

    const result = await client.query<{
      code_verifier_ciphertext: string;
      state_hash: string;
    }>(
      "SELECT state_hash, code_verifier_ciphertext FROM google_oauth_attempts WHERE state_hash = $1",
      [stateHash],
    );

    expect(result.rows[0]).toEqual({
      code_verifier_ciphertext: "encrypted-code-verifier",
      state_hash: stateHash,
    });
    expect(JSON.stringify(result.rows[0])).not.toContain(rawState);
    expect(JSON.stringify(result.rows[0])).not.toContain("raw-pkce-code-verifier");
  });
  it("rejects an OAuth attempt for a user outside the tenant", async () => {
    const fixture = await createOwnerFixture();
    const outsider = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, 'not-a-real-password-hash')
       RETURNING id`,
      [`google-outsider-${randomUUID()}@example.com`],
    );
    const outsiderId = outsider.rows[0]?.id;
    if (!outsiderId) throw new Error("OAuth outsider fixture was not created.");

    await expect(
      client.query(
        `INSERT INTO google_oauth_attempts (
          state_hash, tenant_id, user_id, code_verifier_ciphertext,
          code_verifier_iv, code_verifier_auth_tag, encryption_key_version, expires_at
        ) VALUES ($1, $2, $3, 'encrypted-code-verifier', $4, $5, 1,
                  now() + interval '10 minutes')`,
        [
          "a".repeat(64),
          fixture.tenant_id,
          outsiderId,
          encryptedRefreshToken.iv,
          encryptedRefreshToken.authTag,
        ],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects an OAuth attempt that is already expired", async () => {
    const fixture = await createOwnerFixture();

    await expect(
      client.query(
        `INSERT INTO google_oauth_attempts (
          state_hash, tenant_id, user_id, code_verifier_ciphertext,
          code_verifier_iv, code_verifier_auth_tag, encryption_key_version, expires_at
        ) VALUES ($1, $2, $3, 'encrypted-code-verifier', $4, $5, 1,
                  now() - interval '1 minute')`,
        [
          "b".repeat(64),
          fixture.tenant_id,
          fixture.user_id,
          encryptedRefreshToken.iv,
          encryptedRefreshToken.authTag,
        ],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
