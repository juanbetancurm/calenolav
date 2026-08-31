import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  readEncryptionKeyRingConfig,
  type EncryptionKeyRingConfig,
} from "./google/encryption-config.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  encryptionKeyRing: EncryptionKeyRingConfig;
  redirectUri: string;
}

export interface BookingReconciliationConfig {
  batchSize: number;
  intervalMs: number;
  retryDelayMs: number;
}

export interface ApiConfig {
  bookingReconciliation: BookingReconciliationConfig;
  databaseUrl: string;
  googleOAuth: GoogleOAuthConfig | null;
  host: string;
  port: number;
  secureCookies: boolean;
}

function readBoundedInteger(
  environment: Environment,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const rawValue = environment[name]?.trim();
  const value = rawValue ? Number(rawValue) : defaultValue;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("Booking reconciliation configuration is invalid.");
  }
  return value;
}

function readBookingReconciliationConfig(
  environment: Environment,
): BookingReconciliationConfig {
  return {
    batchSize: readBoundedInteger(
      environment,
      "BOOKING_RECONCILIATION_BATCH_SIZE",
      25,
      1,
      100,
    ),
    intervalMs: readBoundedInteger(
      environment,
      "BOOKING_RECONCILIATION_INTERVAL_MS",
      60_000,
      1_000,
      86_400_000,
    ),
    retryDelayMs: readBoundedInteger(
      environment,
      "BOOKING_RECONCILIATION_RETRY_DELAY_MS",
      5 * 60_000,
      1_000,
      86_400_000,
    ),
  };
}

function readGoogleOAuthConfig(environment: Environment): GoogleOAuthConfig | null {
  const clientId = environment.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = environment.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  const currentKeyVersion =
    environment.OAUTH_ENCRYPTION_CURRENT_KEY_VERSION?.trim();
  const encryptionKeys = environment.OAUTH_ENCRYPTION_KEYS?.trim();
  const hasAnyGoogleOAuthValue = Boolean(
    clientId || clientSecret || redirectUri || currentKeyVersion || encryptionKeys,
  );

  if (!hasAnyGoogleOAuthValue) {
    return null;
  }
  if (!clientId) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID is required when Google OAuth is configured.",
    );
  }
  if (!redirectUri) {
    throw new Error(
      "GOOGLE_OAUTH_REDIRECT_URI is required when Google OAuth is configured.",
    );
  }
  if (!clientSecret) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_SECRET is required when Google OAuth is configured.",
    );
  }

  return {
    clientId,
    clientSecret,
    encryptionKeyRing: readEncryptionKeyRingConfig(environment),
    redirectUri,
  };
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

  const rawSecureCookies = environment.COOKIE_SECURE?.trim().toLowerCase() || "true";
  if (rawSecureCookies !== "true" && rawSecureCookies !== "false") {
    throw new Error("COOKIE_SECURE must be true or false.");
  }

  return {
    bookingReconciliation: readBookingReconciliationConfig(environment),
    databaseUrl,
    googleOAuth: readGoogleOAuthConfig(environment),
    host: environment.API_HOST?.trim() || "0.0.0.0",
    port,
    secureCookies: rawSecureCookies === "true",
  };
}
