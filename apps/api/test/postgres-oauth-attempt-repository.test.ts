import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";
import { PostgresGoogleOAuthAttemptRepository } from "../src/google/postgres-oauth-attempt-repository.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdEmails: string[] = [];
const createdSlugs: string[] = [];

async function createOwnerFixture() {
  const suffix = randomUUID();
  const email = `oauth-attempt-${suffix}@example.com`;
  const slug = `oauth-attempt-${suffix}`;
  createdEmails.push(email);
  createdSlugs.push(slug);

  const result = await pool.query<{ tenant_id: string; user_id: string }>(
    `WITH new_user AS (
       INSERT INTO users (email, password_hash)
       VALUES ($1, 'not-a-real-password-hash')
       RETURNING id
     ), new_tenant AS (
       INSERT INTO tenants (name, slug)
       VALUES ('OAuth Attempt Test', $2)
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
  if (!row) throw new Error("OAuth attempt owner fixture was not created.");
  return row;
}

async function createUserWithoutMembership(): Promise<string> {
  const email = `oauth-attempt-outsider-${randomUUID()}@example.com`;
  createdEmails.push(email);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, 'not-a-real-password-hash')
     RETURNING id`,
    [email],
  );
  const userId = result.rows[0]?.id;
  if (!userId) throw new Error("OAuth attempt outsider fixture was not created.");
  return userId;
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

describe.sequential("PostgresGoogleOAuthAttemptRepository", () => {
  it("maps a protected authorization attempt to its database envelope", async () => {
    const repository = new PostgresGoogleOAuthAttemptRepository(pool);
    const fixture = await createOwnerFixture();
    const stateHash = "c".repeat(64);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);

    await repository.createAttempt({
      codeVerifier: {
        authTag: "DQ4PEBESExQVFhcYGRobHA",
        ciphertext: "encrypted-code-verifier-payload",
        iv: "AQIDBAUGBwgJCgsM",
        keyVersion: 2,
      },
      expiresAt,
      stateHash,
      tenantId: fixture.tenant_id,
      userId: fixture.user_id,
    });

    const result = await pool.query<{
      code_verifier_auth_tag: string;
      code_verifier_ciphertext: string;
      code_verifier_iv: string;
      encryption_key_version: number;
      expires_at: Date;
      state_hash: string;
      tenant_id: string;
      user_id: string;
    }>(
      `SELECT state_hash, tenant_id, user_id, code_verifier_ciphertext,
              code_verifier_iv, code_verifier_auth_tag,
              encryption_key_version, expires_at
         FROM google_oauth_attempts
        WHERE state_hash = $1`,
      [stateHash],
    );

    expect(result.rows).toEqual([
      {
        code_verifier_auth_tag: "DQ4PEBESExQVFhcYGRobHA",
        code_verifier_ciphertext: "encrypted-code-verifier-payload",
        code_verifier_iv: "AQIDBAUGBwgJCgsM",
        encryption_key_version: 2,
        expires_at: expiresAt,
        state_hash: stateHash,
        tenant_id: fixture.tenant_id,
        user_id: fixture.user_id,
      },
    ]);
    expect(JSON.stringify(result.rows)).not.toContain("raw-pkce-code-verifier");
  });

  it("lets the membership foreign key reject an outsider without a partial row", async () => {
    const repository = new PostgresGoogleOAuthAttemptRepository(pool);
    const fixture = await createOwnerFixture();
    const outsiderId = await createUserWithoutMembership();
    const stateHash = "d".repeat(64);

    await expect(
      repository.createAttempt({
        codeVerifier: {
          authTag: "DQ4PEBESExQVFhcYGRobHA",
          ciphertext: "encrypted-code-verifier-payload",
          iv: "AQIDBAUGBwgJCgsM",
          keyVersion: 2,
        },
        expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
        stateHash,
        tenantId: fixture.tenant_id,
        userId: outsiderId,
      }),
    ).rejects.toMatchObject({ code: "23503" });

    const partial = await pool.query<{ count: string }>(
      "SELECT count(*) FROM google_oauth_attempts WHERE state_hash = $1",
      [stateHash],
    );
    expect(partial.rows[0]?.count).toBe("0");
  });
});
