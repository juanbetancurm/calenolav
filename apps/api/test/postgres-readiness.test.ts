import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadEnvironmentFile, readConfig } from "../src/config.js";
import { createPostgresReadinessCheck } from "../src/readiness.js";

loadEnvironmentFile();
const config = readConfig();
const pool = new Pool({ connectionString: config.databaseUrl });

afterAll(async () => {
  await pool.end();
});

describe("PostgreSQL readiness adapter", () => {
  it("completes when PostgreSQL accepts a query", async () => {
    const readinessCheck = createPostgresReadinessCheck(async (statement) =>
      pool.query(statement),
    );

    await expect(readinessCheck()).resolves.toBeUndefined();
  });
});
