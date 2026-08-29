import { describe, expect, it, vi } from "vitest";
import {
  GoogleOAuthCodeClient,
  GoogleOAuthProtocolError,
} from "../src/google/google-oauth-client.js";

const clientId = "client-id.apps.googleusercontent.com";
const clientSecret = "synthetic-client-secret";
const redirectUri = "https://api.calenolav.example/google/oauth/callback";

interface TokenPayload {
  email?: string;
  email_verified?: boolean;
  sub?: string;
}

function createFixture(overrides?: {
  payload?: TokenPayload | null;
  tokens?: {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    scope?: string;
  };
}) {
  const payload = overrides?.payload === undefined
    ? {
        email: "owner@example.com",
        email_verified: true,
        sub: "google-subject-123",
      }
    : overrides.payload;
  const tokens = overrides?.tokens ?? {
    access_token: "short-lived-access-token",
    id_token: "signed-google-id-token",
    refresh_token: "long-lived-refresh-token",
    scope:
      "openid email https://www.googleapis.com/auth/calendar.freebusy " +
      "https://www.googleapis.com/auth/calendar.events.owned",
  };
  const getToken = vi.fn(
    async (_input: { code: string; codeVerifier: string }) => ({ tokens }),
  );
  const verifyIdToken = vi.fn(
    async (_input: { audience: string; idToken: string }) => ({
      getPayload: () => payload ?? undefined,
    }),
  );
  const revokeToken = vi.fn(async (_token: string) => undefined);
  const clientFactory = vi.fn(
    (_options: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    }) => ({ getToken, revokeToken, verifyIdToken }),
  );
  const client = new GoogleOAuthCodeClient({
    clientFactory,
    clientId,
    clientSecret,
    redirectUri,
  });

  return { client, clientFactory, getToken, revokeToken, verifyIdToken };
}

async function expectProtocolFailure(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    message: "Google OAuth response could not be verified.",
    name: "GoogleOAuthProtocolError",
  });
}

describe("GoogleOAuthCodeClient", () => {
  it("exchanges code plus PKCE and verifies identity for the configured audience", async () => {
    const { client, clientFactory, getToken, verifyIdToken } = createFixture();

    await expect(
      client.exchangeCode({
        code: "authorization-code",
        codeVerifier: "server-side-pkce-verifier",
      }),
    ).resolves.toEqual({
      grantedScopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/calendar.events.owned",
      ],
      identity: {
        email: "owner@example.com",
        emailVerified: true,
        subject: "google-subject-123",
      },
      refreshToken: "long-lived-refresh-token",
    });

    expect(clientFactory).toHaveBeenCalledWith({
      clientId,
      clientSecret,
      redirectUri,
    });
    expect(getToken).toHaveBeenCalledWith({
      code: "authorization-code",
      codeVerifier: "server-side-pkce-verifier",
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      audience: clientId,
      idToken: "signed-google-id-token",
    });
  });

  it("does not return the short-lived access token", async () => {
    const { client } = createFixture();

    const result = await client.exchangeCode({
      code: "authorization-code",
      codeVerifier: "server-side-pkce-verifier",
    });

    expect(result).not.toHaveProperty("accessToken");
    expect(JSON.stringify(result)).not.toContain("short-lived-access-token");
  });

  it("revokes a refresh token through the official client and hides provider failures", async () => {
    const success = createFixture();

    await expect(
      success.client.revokeGrant("long-lived-refresh-token"),
    ).resolves.toBeUndefined();
    expect(success.revokeToken).toHaveBeenCalledWith("long-lived-refresh-token");

    const failure = createFixture();
    failure.revokeToken.mockRejectedValueOnce(
      new Error("private provider revocation response"),
    );
    const result = failure.client.revokeGrant("long-lived-refresh-token");

    await expectProtocolFailure(result);
    await expect(result).rejects.not.toThrow("private provider revocation response");
  });

  it("represents an omitted refresh token as null for the service to reject", async () => {
    const { client } = createFixture({
      tokens: {
        id_token: "signed-google-id-token",
        scope:
          "openid  email email https://www.googleapis.com/auth/calendar.freebusy",
      },
    });

    await expect(
      client.exchangeCode({ code: "code", codeVerifier: "verifier" }),
    ).resolves.toMatchObject({
      grantedScopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.freebusy",
      ],
      refreshToken: null,
    });
  });

  it("rejects a token response without an ID token before verification", async () => {
    const { client, verifyIdToken } = createFixture({
      tokens: { refresh_token: "refresh-token", scope: "openid email" },
    });

    await expectProtocolFailure(
      client.exchangeCode({ code: "code", codeVerifier: "verifier" }),
    );

    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects a verified ticket without complete identity claims", async () => {
    const missingPayload = createFixture({ payload: null });
    const missingSubject = createFixture({
      payload: { email: "owner@example.com", email_verified: true },
    });

    await expectProtocolFailure(
      missingPayload.client.exchangeCode({ code: "code", codeVerifier: "verifier" }),
    );
    await expectProtocolFailure(
      missingSubject.client.exchangeCode({ code: "code", codeVerifier: "verifier" }),
    );
  });

  it("maps token exchange and signature failures to one secret-safe error", async () => {
    const exchangeFailure = createFixture();
    exchangeFailure.getToken.mockRejectedValueOnce(
      new Error("invalid_grant with provider response"),
    );
    const verificationFailure = createFixture();
    verificationFailure.verifyIdToken.mockRejectedValueOnce(
      new Error("signature details and certificate URL"),
    );

    const exchangeResult = exchangeFailure.client.exchangeCode({
      code: "code",
      codeVerifier: "verifier",
    });
    const verificationResult = verificationFailure.client.exchangeCode({
      code: "code",
      codeVerifier: "verifier",
    });
    await expectProtocolFailure(exchangeResult);
    await expect(exchangeResult).rejects.not.toThrow("invalid_grant");
    await expectProtocolFailure(verificationResult);
    await expect(verificationResult).rejects.not.toThrow("certificate URL");
  });

  it("rejects incomplete construction without echoing client secrets", () => {
    const clientFactory = vi.fn();

    expect(
      () =>
        new GoogleOAuthCodeClient({
          clientFactory,
          clientId,
          clientSecret: " ",
          redirectUri,
        }),
    ).toThrow("Google OAuth client secret is required.");
    expect(() =>
      new GoogleOAuthCodeClient({
        clientFactory,
        clientId: " ",
        clientSecret,
        redirectUri,
      }),
    ).toThrow("Google OAuth client ID is required.");
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("exports one stable protocol error", () => {
    expect(new GoogleOAuthProtocolError()).toMatchObject({
      message: "Google OAuth response could not be verified.",
      name: "GoogleOAuthProtocolError",
    });
  });
});
