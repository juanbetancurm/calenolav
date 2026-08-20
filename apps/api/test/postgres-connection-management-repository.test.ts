import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";
import { PostgresGoogleCalendarConnectionManagementRepository } from "../src/google/postgres-connection-management-repository.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const createdSlugs: string[] = [];

async function createTenantFixture(): Promise<string> {
  const slug = `connection-management-${randomUUID()}`;
  createdSlugs.push(slug);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, slug)
     VALUES ('Connection Management Test', $1)
     RETURNING id`,
    [slug],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Connection management tenant was not created.");
  return row.id;
}

async function insertConnection(
  tenantId: string,
  input: { connectedAt: Date; email: string; updatedAt: Date },
): Promise<void> {
  await pool.query(
    `INSERT INTO google_calendar_connections (
       tenant_id, google_subject, google_account_email, calendar_id,
       refresh_token_ciphertext, refresh_token_iv,
       refresh_token_auth_tag, encryption_key_version, granted_scopes,
       connected_at, updated_at
     ) VALUES ($1, 'internal-google-subject', $2, 'primary',
               'encrypted-refresh-token', 'AQIDBAUGBwgJCgsM',
               'DQ4PEBESExQVFhcYGRobHA', 2,
               ARRAY['scope-a', 'scope-b'], $3, $4)`,
    [tenantId, input.email, input.connectedAt, input.updatedAt],
  );
}

beforeAll(async () => {
  await pool.query("select 1");
});

afterEach(async () => {
  await pool.query("DELETE FROM tenants WHERE slug = ANY($1::text[])", [
    createdSlugs,
  ]);
  createdSlugs.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe.sequential("PostgresGoogleCalendarConnectionManagementRepository", () => {
  it("returns only safe status columns for one tenant", async () => {
    const repository =
      new PostgresGoogleCalendarConnectionManagementRepository(pool);
    const tenantId = await createTenantFixture();
    const connectedAt = new Date("2026-08-20T12:00:00.000Z");
    const updatedAt = new Date("2026-08-20T13:00:00.000Z");
    await insertConnection(tenantId, {
      connectedAt,
      email: "calendar-owner@example.com",
      updatedAt,
    });

    const result = await repository.findConnectionStatus(tenantId);

    expect(result).toEqual({
      calendarId: "primary",
      connectedAt,
      googleAccountEmail: "calendar-owner@example.com",
      grantedScopes: ["scope-a", "scope-b"],
      updatedAt,
    });
    expect(JSON.stringify(result)).not.toContain("internal-google-subject");
    expect(JSON.stringify(result)).not.toContain("encrypted-refresh-token");
  });

  it("returns null when the tenant has no Google connection", async () => {
    const repository =
      new PostgresGoogleCalendarConnectionManagementRepository(pool);
    const tenantId = await createTenantFixture();

    await expect(repository.findConnectionStatus(tenantId)).resolves.toBeNull();
  });

  it("deletes only the selected tenant connection and is safe to repeat", async () => {
    const repository =
      new PostgresGoogleCalendarConnectionManagementRepository(pool);
    const selectedTenantId = await createTenantFixture();
    const preservedTenantId = await createTenantFixture();
    const connectedAt = new Date("2026-08-20T12:00:00.000Z");
    const updatedAt = new Date("2026-08-20T13:00:00.000Z");
    await insertConnection(selectedTenantId, {
      connectedAt,
      email: "selected@example.com",
      updatedAt,
    });
    await insertConnection(preservedTenantId, {
      connectedAt,
      email: "preserved@example.com",
      updatedAt,
    });

    await repository.deleteConnection(selectedTenantId);
    await repository.deleteConnection(selectedTenantId);

    const result = await pool.query<{ count: string; tenant_id: string }>(
      `SELECT tenant_id, count(*)::text AS count
         FROM google_calendar_connections
        WHERE tenant_id = ANY($1::uuid[])
        GROUP BY tenant_id`,
      [[selectedTenantId, preservedTenantId]],
    );
    expect(result.rows).toEqual([{ count: "1", tenant_id: preservedTenantId }]);
  });
});
