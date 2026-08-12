import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadEnvironment } from "dotenv";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

loadEnvironment({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests.");
}

const client = new Client({ connectionString: databaseUrl });

describe.sequential("identity schema", () => {
  beforeAll(async () => {
    await client.connect();
  });

  beforeEach(async () => {
    await client.query("BEGIN");
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  afterAll(async () => {
    await client.end();
  });

  it("stores an owner membership between one user and one tenant", async () => {
    const userId = randomUUID();
    const tenantId = randomUUID();

    await client.query(
      "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)",
      [userId, "owner@example.com", "not-a-real-password-hash"],
    );
    await client.query(
      "INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)",
      [tenantId, "Example owner", "example-owner"],
    );
    await client.query(
      "INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
      [tenantId, userId],
    );

    const result = await client.query<{ role: string }>(
      "SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2",
      [tenantId, userId],
    );

    expect(result.rows).toEqual([{ role: "owner" }]);
  });

  it("treats email addresses as case-insensitively unique", async () => {
    await client.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2)",
      ["Owner@Example.com", "first-placeholder-hash"],
    );

    await expect(
      client.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2)",
        ["owner@example.com", "second-placeholder-hash"],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects slugs that cannot be used safely in a public URL", async () => {
    await expect(
      client.query("INSERT INTO tenants (name, slug) VALUES ($1, $2)", [
        "Invalid tenant",
        "Not Valid!",
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects memberships for a tenant that does not exist", async () => {
    const userId = randomUUID();

    await client.query(
      "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)",
      [userId, "isolated@example.com", "placeholder-hash"],
    );

    await expect(
      client.query(
        "INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
        [randomUUID(), userId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
