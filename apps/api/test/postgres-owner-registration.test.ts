import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";
import { RegistrationConflictError } from "../src/auth/register-owner.js";
import { PostgresOwnerRegistrationRepository } from "../src/auth/postgres-owner-registration.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdEmails: string[] = [];
const createdSlugs: string[] = [];

type RegistrationInput = Parameters<
  PostgresOwnerRegistrationRepository["createOwnerRegistration"]
>[0];

function registration(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  const suffix = randomUUID();
  const email = `registration-${suffix}@example.com`;
  const slug = `registration-${suffix}`;
  createdEmails.push(email);
  createdSlugs.push(slug);

  return {
    email,
    locale: "es",
    name: "Registration Test",
    passwordHash: "scrypt$test-only-placeholder",
    sessionExpiresAt: new Date("2026-09-11T12:00:00.000Z"),
    sessionTokenHash: suffix.replaceAll("-", "").padEnd(64, "0"),
    slug,
    ...overrides,
  };
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

describe.sequential("PostgresOwnerRegistrationRepository", () => {
  it("atomically creates a user, tenant, owner membership, and hashed session", async () => {
    const repository = new PostgresOwnerRegistrationRepository(pool);
    const input = registration();

    const ids = await repository.createOwnerRegistration(input);

    const result = await pool.query<{
      email: string;
      role: string;
      slug: string;
      token_hash: string;
    }>(
      `SELECT u.email, t.slug, tm.role, s.token_hash
         FROM users u
         JOIN tenant_memberships tm ON tm.user_id = u.id
         JOIN tenants t ON t.id = tm.tenant_id
         JOIN sessions s ON s.user_id = u.id
        WHERE u.id = $1 AND t.id = $2`,
      [ids.userId, ids.tenantId],
    );

    expect(result.rows).toEqual([
      {
        email: input.email,
        role: "owner",
        slug: input.slug,
        token_hash: input.sessionTokenHash,
      },
    ]);
  });

  it("rolls back the user when tenant creation has a late slug conflict", async () => {
    const repository = new PostgresOwnerRegistrationRepository(pool);
    const first = registration();
    await repository.createOwnerRegistration(first);
    const conflicting = registration({ slug: first.slug });

    await expect(repository.createOwnerRegistration(conflicting)).rejects.toBeInstanceOf(
      RegistrationConflictError,
    );

    const partialUser = await pool.query<{ count: string }>(
      "SELECT count(*) FROM users WHERE email = $1",
      [conflicting.email],
    );
    expect(partialUser.rows[0]?.count).toBe("0");
  });
});
