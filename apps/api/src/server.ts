import { Pool } from "pg";
import { buildApp } from "./app.js";
import { loadEnvironmentFile, readConfig } from "./config.js";
import { createPostgresReadinessCheck } from "./readiness.js";

loadEnvironmentFile();
const config = readConfig();

const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  max: 10,
});

const app = buildApp({
  logger: true,
  readinessCheck: createPostgresReadinessCheck(async (statement) => pool.query(statement)),
});

app.addHook("onClose", async () => {
  await pool.end();
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "Shutting down API");
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "API shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, "API startup failed");
  await app.close();
  process.exitCode = 1;
}
