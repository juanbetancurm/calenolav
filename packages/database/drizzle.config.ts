import { fileURLToPath } from "node:url";
import { config as loadEnvironment } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnvironment({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env first.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
