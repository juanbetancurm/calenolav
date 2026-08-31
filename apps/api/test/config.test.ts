import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("API configuration", () => {
  it("uses safe local HTTP defaults", () => {
    expect(readConfig({ DATABASE_URL: "postgresql://example" })).toEqual({
      bookingReconciliation: {
        batchSize: 25,
        intervalMs: 60_000,
        retryDelayMs: 5 * 60_000,
      },
      databaseUrl: "postgresql://example",
      googleOAuth: null,
      host: "0.0.0.0",
      port: 3000,
      secureCookies: true,
    });
  });

  it("accepts explicit host and port settings", () => {
    expect(
      readConfig({
        API_HOST: "127.0.0.1",
        API_PORT: "4000",
        COOKIE_SECURE: "false",
        DATABASE_URL: "postgresql://example",
      }),
    ).toMatchObject({ host: "127.0.0.1", port: 4000, secureCookies: false });
  });

  it("rejects missing database configuration", () => {
    expect(() => readConfig({})).toThrow("DATABASE_URL is required");
  });

  it("rejects an invalid COOKIE_SECURE value", () => {
    expect(() =>
      readConfig({ COOKIE_SECURE: "sometimes", DATABASE_URL: "postgresql://example" }),
    ).toThrow("COOKIE_SECURE must be true or false");
  });

  it("loads complete optional Google OAuth configuration", () => {
    const encryptionKey = Buffer.alloc(32, 17).toString("base64url");

    const config = readConfig({
      DATABASE_URL: "postgresql://example",
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
      GOOGLE_OAUTH_REDIRECT_URI: "https://api.calenolav.example/google/oauth/callback",
      OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "1",
      OAUTH_ENCRYPTION_KEYS: `1:${encryptionKey}`,
    });

    expect(config.googleOAuth).toEqual({
      clientId: "google-client-id.apps.googleusercontent.com",
      clientSecret: "synthetic-client-secret",
      encryptionKeyRing: {
        currentKeyVersion: 1,
        keys: new Map([[1, Buffer.alloc(32, 17)]]),
      },
      redirectUri: "https://api.calenolav.example/google/oauth/callback",
    });
  });

  it("requires the client secret as part of complete OAuth configuration", () => {
    const encryptionKey = Buffer.alloc(32, 17).toString("base64url");

    expect(() =>
      readConfig({
        DATABASE_URL: "postgresql://example",
        GOOGLE_OAUTH_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
        GOOGLE_OAUTH_REDIRECT_URI:
          "https://api.calenolav.example/google/oauth/callback",
        OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "1",
        OAUTH_ENCRYPTION_KEYS: `1:${encryptionKey}`,
      }),
    ).toThrow(
      "GOOGLE_OAUTH_CLIENT_SECRET is required when Google OAuth is configured",
    );
    expect(() =>
      readConfig({
        DATABASE_URL: "postgresql://example",
        GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
      }),
    ).toThrow(
      "GOOGLE_OAUTH_CLIENT_ID is required when Google OAuth is configured",
    );
  });

  it("rejects partial Google OAuth configuration", () => {
    expect(() =>
      readConfig({
        DATABASE_URL: "postgresql://example",
        GOOGLE_OAUTH_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
      }),
    ).toThrow(
      "GOOGLE_OAUTH_REDIRECT_URI is required when Google OAuth is configured",
    );
  });
  it.each(["0", "65536", "not-a-port"])("rejects invalid API_PORT %s", (port) => {
    expect(() =>
      readConfig({ API_PORT: port, DATABASE_URL: "postgresql://example" }),
    ).toThrow("API_PORT must be an integer between 1 and 65535");
  });

  it("accepts bounded booking reconciliation settings", () => {
    expect(
      readConfig({
        BOOKING_RECONCILIATION_BATCH_SIZE: "40",
        BOOKING_RECONCILIATION_INTERVAL_MS: "120000",
        BOOKING_RECONCILIATION_RETRY_DELAY_MS: "600000",
        DATABASE_URL: "postgresql://example",
      }).bookingReconciliation,
    ).toEqual({ batchSize: 40, intervalMs: 120_000, retryDelayMs: 600_000 });
  });

  it.each([
    ["BOOKING_RECONCILIATION_BATCH_SIZE", "0"],
    ["BOOKING_RECONCILIATION_BATCH_SIZE", "101"],
    ["BOOKING_RECONCILIATION_INTERVAL_MS", "999"],
    ["BOOKING_RECONCILIATION_RETRY_DELAY_MS", "0"],
  ])("rejects unsafe %s configuration", (name, value) => {
    expect(() =>
      readConfig({ DATABASE_URL: "postgresql://example", [name]: value }),
    ).toThrow("Booking reconciliation configuration is invalid");
  });
});
