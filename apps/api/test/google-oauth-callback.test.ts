import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GOOGLE_CALENDAR_SCOPES } from "../src/google/oauth-authorization.js";
import {
  CompleteGoogleOAuthService,
  GoogleOAuthCallbackError,
} from "../src/google/oauth-callback.js";
import { SecretDecryptionError } from "../src/google/secret-box.js";

const now = new Date("2026-08-18T12:00:00.000Z");
const rawState = "opaque-state-returned-by-google";
const stateHash = createHash("sha256").update(rawState).digest("hex");
const tenantId = "00000000-0000-4000-8000-000000000101";
const userId = "00000000-0000-4000-8000-000000000102";
const codeVerifier = "server-side-pkce-verifier";

const encryptedCodeVerifier = {
  authTag: "bbbbbbbbbbbbbbbbbbbbbb",
  ciphertext: "encrypted-code-verifier",
  iv: "aaaaaaaaaaaaaaaa",
  keyVersion: 1,
};

const encryptedRefreshToken = {
  authTag: "dddddddddddddddddddddd",
  ciphertext: "encrypted-refresh-token",
  iv: "cccccccccccccccc",
  keyVersion: 2,
};

const activeAttempt = {
  codeVerifier: encryptedCodeVerifier,
  expiresAt: new Date("2026-08-18T12:05:00.000Z"),
  stateHash,
  tenantId,
  userId,
};

interface TestExchangeResult {
  grantedScopes: string[];
  identity: {
    email: string;
    emailVerified: boolean;
    subject: string;
  };
  refreshToken: string | null;
}

const successfulExchange: TestExchangeResult = {
  grantedScopes: [...GOOGLE_CALENDAR_SCOPES],
  identity: {
    email: " Owner@Example.com ",
    emailVerified: true,
    subject: "google-subject-123",
  },
  refreshToken: "raw-refresh-token",
};

function createFixture() {
  const repository = {
    consumeAttempt: vi.fn<
      (requestedStateHash: string) => Promise<typeof activeAttempt | null>
    >(async (_requestedStateHash) => activeAttempt),
    saveConnection: vi.fn(async (_connection: unknown) => undefined),
  };
  const secretBox = {
    decrypt: vi.fn(() => codeVerifier),
    encrypt: vi.fn(() => encryptedRefreshToken),
  };
  const googleClient = {
    exchangeCode: vi.fn<
      (input: { code: string; codeVerifier: string }) =>
        Promise<TestExchangeResult>
    >(async (_input) => successfulExchange),
  };
  const service = new CompleteGoogleOAuthService({
    clock: () => now,
    googleClient,
    repository,
    secretBox,
  });

  return { googleClient, repository, secretBox, service };
}

async function expectGenericFailure(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    message: "Google Calendar connection could not be completed.",
    name: "GoogleOAuthCallbackError",
  });
}

describe("CompleteGoogleOAuthService", () => {
  it("consumes state, opens PKCE, exchanges the code, and saves an encrypted connection", async () => {
    const { googleClient, repository, secretBox, service } = createFixture();

    await expect(
      service.execute({ code: "authorization-code", state: rawState }),
    ).resolves.toEqual({ tenantId });

    expect(repository.consumeAttempt).toHaveBeenCalledWith(stateHash);
    expect(secretBox.decrypt).toHaveBeenCalledWith(
      encryptedCodeVerifier,
      `google-oauth-code-verifier:${tenantId}:${stateHash}`,
    );
    expect(googleClient.exchangeCode).toHaveBeenCalledWith({
      code: "authorization-code",
      codeVerifier,
    });
    expect(secretBox.encrypt).toHaveBeenCalledWith(
      "raw-refresh-token",
      `google-refresh-token:${tenantId}`,
    );
    expect(repository.saveConnection).toHaveBeenCalledWith({
      calendarId: "primary",
      googleAccountEmail: "owner@example.com",
      googleSubject: "google-subject-123",
      grantedScopes: [...GOOGLE_CALENDAR_SCOPES],
      refreshToken: encryptedRefreshToken,
      tenantId,
    });
  });

  it("rejects unknown state before decryption or Google exchange", async () => {
    const { googleClient, repository, secretBox, service } = createFixture();
    repository.consumeAttempt.mockResolvedValueOnce(null);

    await expectGenericFailure(
      service.execute({ code: "authorization-code", state: rawState }),
    );

    expect(secretBox.decrypt).not.toHaveBeenCalled();
    expect(googleClient.exchangeCode).not.toHaveBeenCalled();
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("consumes but rejects an expired attempt", async () => {
    const { googleClient, repository, secretBox, service } = createFixture();
    repository.consumeAttempt.mockResolvedValueOnce({
      ...activeAttempt,
      expiresAt: new Date("2026-08-18T11:59:59.999Z"),
    });

    await expectGenericFailure(
      service.execute({ code: "authorization-code", state: rawState }),
    );

    expect(repository.consumeAttempt).toHaveBeenCalledOnce();
    expect(secretBox.decrypt).not.toHaveBeenCalled();
    expect(googleClient.exchangeCode).not.toHaveBeenCalled();
  });

  it("allows a state digest to complete at most once", async () => {
    const { googleClient, repository, service } = createFixture();
    repository.consumeAttempt
      .mockResolvedValueOnce(activeAttempt)
      .mockResolvedValueOnce(null);

    await service.execute({ code: "first-code", state: rawState });
    await expectGenericFailure(
      service.execute({ code: "replayed-code", state: rawState }),
    );

    expect(googleClient.exchangeCode).toHaveBeenCalledOnce();
    expect(repository.saveConnection).toHaveBeenCalledOnce();
  });

  it("uses one generic failure when the protected verifier cannot be opened", async () => {
    const { googleClient, repository, secretBox, service } = createFixture();
    secretBox.decrypt.mockImplementationOnce(() => {
      throw new SecretDecryptionError();
    });

    await expectGenericFailure(
      service.execute({ code: "authorization-code", state: rawState }),
    );

    expect(googleClient.exchangeCode).not.toHaveBeenCalled();
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("does not expose Google exchange errors or reuse the consumed attempt", async () => {
    const { googleClient, repository, service } = createFixture();
    googleClient.exchangeCode.mockRejectedValueOnce(
      new Error("invalid_grant containing provider details"),
    );

    const result = service.execute({
      code: "authorization-code",
      state: rawState,
    });
    await expectGenericFailure(result);
    await expect(result).rejects.not.toThrow("invalid_grant");

    expect(repository.consumeAttempt).toHaveBeenCalledOnce();
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("requires a refresh token and every Calendar scope before persistence", async () => {
    const { googleClient, repository, secretBox, service } = createFixture();
    googleClient.exchangeCode
      .mockResolvedValueOnce({ ...successfulExchange, refreshToken: null })
      .mockResolvedValueOnce({
        ...successfulExchange,
        grantedScopes: [GOOGLE_CALENDAR_SCOPES[0]],
      });

    await expectGenericFailure(
      service.execute({ code: "first-code", state: rawState }),
    );
    await expectGenericFailure(
      service.execute({ code: "second-code", state: rawState }),
    );

    expect(secretBox.encrypt).not.toHaveBeenCalled();
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("requires a verified, nonblank Google identity", async () => {
    const { googleClient, repository, secretBox, service } = createFixture();
    googleClient.exchangeCode
      .mockResolvedValueOnce({
        ...successfulExchange,
        identity: { ...successfulExchange.identity, emailVerified: false },
      })
      .mockResolvedValueOnce({
        ...successfulExchange,
        identity: { ...successfulExchange.identity, subject: "   " },
      });

    await expectGenericFailure(
      service.execute({ code: "first-code", state: rawState }),
    );
    await expectGenericFailure(
      service.execute({ code: "second-code", state: rawState }),
    );

    expect(secretBox.encrypt).not.toHaveBeenCalled();
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("rejects blank callback values before hashing or persistence", async () => {
    const { googleClient, repository, service } = createFixture();

    await expectGenericFailure(service.execute({ code: "", state: rawState }));
    await expectGenericFailure(
      service.execute({ code: "authorization-code", state: " " }),
    );

    expect(repository.consumeAttempt).not.toHaveBeenCalled();
    expect(googleClient.exchangeCode).not.toHaveBeenCalled();
  });

  it("exports one stable privacy-safe callback error", () => {
    expect(new GoogleOAuthCallbackError()).toMatchObject({
      message: "Google Calendar connection could not be completed.",
      name: "GoogleOAuthCallbackError",
    });
  });
});
