import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

type Environment = Readonly<Record<string, string | undefined>>;

export interface ApiConfig {
  databaseUrl: string;
  host: string;
  port: number;
}

export function loadEnvironmentFile(): void {
  loadDotenv({
    path: fileURLToPath(new URL("../../../.env", import.meta.url)),
    quiet: true,
  });
}

export function readConfig(environment: Environment = process.env): ApiConfig {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const rawPort = environment.API_PORT?.trim() || "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }

  return {
    databaseUrl,
    host: environment.API_HOST?.trim() || "0.0.0.0",
    port,
  };
}
