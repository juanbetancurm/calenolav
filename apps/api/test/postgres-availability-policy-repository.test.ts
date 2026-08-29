import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEnvironmentFile, readConfig } from "../src/config.js";
import { PostgresAvailabilityPolicyRepository } from "../src/availability/postgres-policy-repository.js";

loadEnvironmentFile();
const pool = new Pool({ connectionString: readConfig().databaseUrl });
const tenantIds: string[] = [];
const basePolicy = {
  bookingWindowDays: 60,
  minimumNoticeMinutes: 120,
  slotDurationMinutes: 30,
  timeZone: "America/Bogota",
  windows: [
    { endMinute: 720, startMinute: 540, weekday: 1 },
    { endMinute: 1020, startMinute: 780, weekday: 1 },
  ],
};

async function createTenant(): Promise<string> {
  const tenantId = randomUUID();
  tenantIds.push(tenantId);
  await pool.query(
    "INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)",
    [tenantId, "Policy repository test", `policy-repository-${tenantId}`],
  );
  return tenantId;
}

describe.sequential("PostgresAvailabilityPolicyRepository", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1");
  });

  afterEach(async () => {
    if (tenantIds.length > 0) {
      await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [
        tenantIds.splice(0),
      ]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("stores and reads one canonical tenant policy", async () => {
    const repository = new PostgresAvailabilityPolicyRepository(pool);
    const tenantId = await createTenant();

    await repository.replacePolicy(tenantId, basePolicy);

    await expect(repository.findPolicy(tenantId)).resolves.toEqual(basePolicy);
  });

  it("replaces settings and all prior windows without affecting another tenant", async () => {
    const repository = new PostgresAvailabilityPolicyRepository(pool);
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    await repository.replacePolicy(tenantId, basePolicy);
    await repository.replacePolicy(otherTenantId, basePolicy);
    const replacement = {
      ...basePolicy,
      bookingWindowDays: 30,
      windows: [{ endMinute: 900, startMinute: 600, weekday: 2 }],
    };

    await repository.replacePolicy(tenantId, replacement);

    await expect(repository.findPolicy(tenantId)).resolves.toEqual(replacement);
    await expect(repository.findPolicy(otherTenantId)).resolves.toEqual(basePolicy);
  });

  it("rolls back the complete replacement when a window insert fails", async () => {
    const repository = new PostgresAvailabilityPolicyRepository(pool);
    const tenantId = await createTenant();
    await repository.replacePolicy(tenantId, basePolicy);
    const duplicateWindow = { endMinute: 900, startMinute: 600, weekday: 2 };

    await expect(
      repository.replacePolicy(tenantId, {
        ...basePolicy,
        bookingWindowDays: 10,
        windows: [duplicateWindow, duplicateWindow],
      }),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(repository.findPolicy(tenantId)).resolves.toEqual(basePolicy);
  });
});
