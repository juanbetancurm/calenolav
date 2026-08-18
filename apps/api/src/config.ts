import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  readEncryptionKeyRingConfig,
  type EncryptionKeyRingConfig,
} from "./google/encryption-config.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface GoogleOAuthConfig {
  clientId: string;
  encryptionKeyRing: EncryptionKeyRingConfig;
  redirectUri: string;
}

export interface ApiConfig {
  databaseUrl: string;
  googleOAuth: GoogleOAuthConfig | null;
  host: string;
  port: number;
  secureCookies: boolean;
}

function readGoogleOAuthConfig(environment: Environment): GoogleOAuthConfig | null {
  const clientId = environment.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const redirectUri = environment.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  const currentKeyVersion =
    environment.OAUTH_ENCRYPTION_CURRENT_KEY_VERSION?.trim();
  const encryptionKeys = environment.OAUTH_ENCRYPTION_KEYS?.trim();
  const hasAnyGoogleOAuthValue = Boolean(
    clientId || redirectUri || currentKeyVersion || encryptionKeys,
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

  return {
    clientId,
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
    databaseUrl,
    googleOAuth: readGoogleOAuthConfig(environment),
    host: environment.API_HOST?.trim() || "0.0.0.0",
    port,
    secureCookies: rawSecureCookies === "true",
  };
}
