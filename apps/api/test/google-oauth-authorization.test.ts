import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedPrincipal } from "../src/auth/session-services.js";
import { AuthorizationError } from "../src/auth/session-services.js";
import {
  BeginGoogleOAuthService,
  GOOGLE_CALENDAR_SCOPES,
  type GoogleOAuthAttemptRepository,
  type SecretEncryptor,
} from "../src/google/oauth-authorization.js";

const now = new Date("2026-08-17T18:30:00.000Z");
const userId = "00000000-0000-4000-8000-000000000001";
const tenantId = "00000000-0000-4000-8000-000000000002";
const principal: AuthenticatedPrincipal = {
  email: "owner@example.com",
  memberships: [{ role: "owner", tenantId }],
  userId,
};

function createDependencies() {
  const repository: GoogleOAuthAttemptRepository = {
    createAttempt: vi.fn(async () => undefined),
  };
  const secretEncryptor: SecretEncryptor = {
    encrypt: vi.fn(() => ({
      authTag: "t".repeat(22),
      ciphertext: "encrypted-code-verifier",
      iv: "i".repeat(16),
      keyVersion: 3,
    })),
  };
  const randomBytes = vi
    .fn<(size: number) => Buffer>()
    .mockReturnValueOnce(Buffer.alloc(32, 17))
    .mockReturnValueOnce(Buffer.alloc(32, 29));

  return { randomBytes, repository, secretEncryptor };
}

function buildService(dependencies = createDependencies()) {
  return {
    dependencies,
    service: new BeginGoogleOAuthService({
      ...dependencies,
      attemptDurationMs: 10 * 60 * 1_000,
      clientId: "google-client-id.apps.googleusercontent.com",
      clock: () => now,
      redirectUri: "https://api.calenolav.example/google/oauth/callback",
    }),
  };
}

describe("BeginGoogleOAuthService", () => {
  it("stores a protected attempt and returns a minimal offline authorization URL", async () => {
    const { dependencies, service } = buildService();
    const rawState = Buffer.alloc(32, 17).toString("base64url");
    const codeVerifier = Buffer.alloc(32, 29).toString("base64url");
    const stateHash = createHash("sha256").update(rawState).digest("hex");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    const result = await service.execute({ principal, tenantId });
    const authorizationUrl = new URL(result.authorizationUrl);

    expect(dependencies.randomBytes).toHaveBeenNthCalledWith(1, 32);
    expect(dependencies.randomBytes).toHaveBeenNthCalledWith(2, 32);
    expect(dependencies.secretEncryptor.encrypt).toHaveBeenCalledWith(
      codeVerifier,
      `google-oauth-code-verifier:${tenantId}:${stateHash}`,
    );
    expect(dependencies.repository.createAttempt).toHaveBeenCalledWith({
      codeVerifier: {
        authTag: "t".repeat(22),
        ciphertext: "encrypted-code-verifier",
        iv: "i".repeat(16),
        keyVersion: 3,
      },
      expiresAt: new Date("2026-08-17T18:40:00.000Z"),
      stateHash,
      tenantId,
      userId,
    });
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toMatchObject({
      access_type: "offline",
      client_id: "google-client-id.apps.googleusercontent.com",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      include_granted_scopes: "true",
      redirect_uri: "https://api.calenolav.example/google/oauth/callback",
      response_type: "code",
      scope: ["openid", "email", ...GOOGLE_CALENDAR_SCOPES].join(" "),
      state: rawState,
    });
    expect(authorizationUrl.searchParams.get("prompt")).toBeNull();
    expect(result.authorizationUrl).not.toContain(codeVerifier);
    expect(result).toEqual({ authorizationUrl: authorizationUrl.toString() });
  });

  it.each([
    {
      name: "a member",
      principal: { ...principal, memberships: [{ role: "member" as const, tenantId }] },
      tenantId,
    },
    {
      name: "an owner of another tenant",
      principal,
      tenantId: "00000000-0000-4000-8000-000000000099",
    },
  ])("rejects $name before generating or persisting secrets", async (input) => {
    const { dependencies, service } = buildService();

    await expect(service.execute(input)).rejects.toBeInstanceOf(AuthorizationError);
    expect(dependencies.randomBytes).not.toHaveBeenCalled();
    expect(dependencies.secretEncryptor.encrypt).not.toHaveBeenCalled();
    expect(dependencies.repository.createAttempt).not.toHaveBeenCalled();
  });

  it("rejects unsafe construction before an authorization can start", () => {
    const dependencies = createDependencies();

    expect(
      () =>
        new BeginGoogleOAuthService({
          ...dependencies,
          attemptDurationMs: 0,
          clientId: "google-client-id.apps.googleusercontent.com",
          clock: () => now,
          redirectUri: "https://api.calenolav.example/google/oauth/callback",
        }),
    ).toThrow("attemptDurationMs must be a positive finite number");
    expect(
      () =>
        new BeginGoogleOAuthService({
          ...dependencies,
          attemptDurationMs: 600_000,
          clientId: "",
          clock: () => now,
          redirectUri: "not-a-valid-url",
        }),
    ).toThrow("Google OAuth client ID is required");
    expect(
      () =>
        new BeginGoogleOAuthService({
          ...dependencies,
          attemptDurationMs: 600_000,
          clientId: "google-client-id.apps.googleusercontent.com",
          clock: () => now,
          redirectUri: "not-a-valid-url",
        }),
    ).toThrow("Google OAuth redirect URI must be a valid absolute URL");
  });

  it("rejects insufficient entropy before encryption or persistence", async () => {
    const dependencies = createDependencies();
    dependencies.randomBytes.mockReset().mockReturnValue(Buffer.alloc(31, 1));
    const { service } = buildService(dependencies);

    await expect(service.execute({ principal, tenantId })).rejects.toThrow(
      "OAuth random source must return exactly 32 bytes",
    );
    expect(dependencies.secretEncryptor.encrypt).not.toHaveBeenCalled();
    expect(dependencies.repository.createAttempt).not.toHaveBeenCalled();
  });
});

describe("Google Calendar OAuth scopes", () => {
  it("requests availability plus event management only on owned calendars", () => {
    expect(GOOGLE_CALENDAR_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.events.owned",
    ]);
  });
});
