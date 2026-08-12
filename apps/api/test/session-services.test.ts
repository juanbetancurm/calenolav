import { describe, expect, it, vi } from "vitest";
import {
  AuthenticateSessionService,
  AuthorizationError,
  InvalidCredentialsError,
  InvalidSessionError,
  SignInService,
  SignOutService,
  requireTenantRole,
  type SessionRepository,
} from "../src/auth/session-services.js";
import type { PasswordVerifier, SessionTokenHasher } from "../src/auth/session-services.js";
import type { SessionTokenIssuer } from "../src/auth/register-owner.js";

const now = new Date("2026-08-12T14:00:00.000Z");
const sessionDurationMs = 30 * 24 * 60 * 60 * 1_000;
const userId = "00000000-0000-4000-8000-000000000001";
const tenantId = "00000000-0000-4000-8000-000000000002";

function createDependencies() {
  const repository: SessionRepository = {
    createSession: vi.fn(async () => undefined),
    findSessionByTokenHash: vi.fn(async () => null),
    findUserCredentialsByEmail: vi.fn(async () => null),
    revokeSessionByTokenHash: vi.fn(async () => undefined),
    touchSession: vi.fn(async () => undefined),
  };
  const passwordVerifier: PasswordVerifier = {
    verify: vi.fn(async () => false),
  };
  const sessionTokenIssuer: SessionTokenIssuer = {
    issue: vi.fn(() => ({
      rawToken: "new-raw-session-token",
      tokenHash: "b".repeat(64),
    })),
  };
  const sessionTokenHasher: SessionTokenHasher = {
    hash: vi.fn(() => "c".repeat(64)),
  };

  return { passwordVerifier, repository, sessionTokenHasher, sessionTokenIssuer };
}

describe("SignInService", () => {
  it("normalizes email, verifies the password, and rotates to a new session", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findUserCredentialsByEmail).mockResolvedValue({
      email: "owner@example.com",
      passwordHash: "scrypt$stored-hash",
      userId,
    });
    vi.mocked(dependencies.passwordVerifier.verify).mockResolvedValue(true);
    const service = new SignInService({
      ...dependencies,
      clock: () => now,
      dummyPasswordHash: "scrypt$dummy-hash",
      sessionDurationMs,
    });

    const result = await service.execute({
      email: " Owner@Example.COM ",
      password: "  password remains unchanged  ",
    });

    expect(dependencies.repository.findUserCredentialsByEmail).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(dependencies.passwordVerifier.verify).toHaveBeenCalledWith(
      "  password remains unchanged  ",
      "scrypt$stored-hash",
    );
    expect(dependencies.repository.createSession).toHaveBeenCalledWith({
      expiresAt: new Date("2026-09-11T14:00:00.000Z"),
      tokenHash: "b".repeat(64),
      userId,
    });
    expect(result).toEqual({
      email: "owner@example.com",
      expiresAt: new Date("2026-09-11T14:00:00.000Z"),
      sessionToken: "new-raw-session-token",
      userId,
    });
  });

  it("uses the same error and dummy verification when the account does not exist", async () => {
    const dependencies = createDependencies();
    const service = new SignInService({
      ...dependencies,
      clock: () => now,
      dummyPasswordHash: "scrypt$dummy-hash",
      sessionDurationMs,
    });

    await expect(
      service.execute({ email: "missing@example.com", password: "unknown password value" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(dependencies.passwordVerifier.verify).toHaveBeenCalledWith(
      "unknown password value",
      "scrypt$dummy-hash",
    );
    expect(dependencies.sessionTokenIssuer.issue).not.toHaveBeenCalled();
    expect(dependencies.repository.createSession).not.toHaveBeenCalled();
  });

  it("uses the same error when the account exists but the password is wrong", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findUserCredentialsByEmail).mockResolvedValue({
      email: "owner@example.com",
      passwordHash: "scrypt$stored-hash",
      userId,
    });
    const service = new SignInService({
      ...dependencies,
      clock: () => now,
      dummyPasswordHash: "scrypt$dummy-hash",
      sessionDurationMs,
    });

    await expect(
      service.execute({ email: "owner@example.com", password: "wrong password value" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(dependencies.sessionTokenIssuer.issue).not.toHaveBeenCalled();
  });
});

describe("AuthenticateSessionService", () => {
  it("returns a tenant-aware principal for an active session and updates last use", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findSessionByTokenHash).mockResolvedValue({
      email: "owner@example.com",
      expiresAt: new Date("2026-08-13T14:00:00.000Z"),
      memberships: [{ role: "owner", tenantId }],
      revokedAt: null,
      sessionId: "00000000-0000-4000-8000-000000000003",
      userId,
    });
    const service = new AuthenticateSessionService({
      clock: () => now,
      repository: dependencies.repository,
      sessionTokenHasher: dependencies.sessionTokenHasher,
    });

    const principal = await service.execute("raw-session-token");

    expect(dependencies.sessionTokenHasher.hash).toHaveBeenCalledWith("raw-session-token");
    expect(dependencies.repository.findSessionByTokenHash).toHaveBeenCalledWith(
      "c".repeat(64),
    );
    expect(dependencies.repository.touchSession).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000003",
      now,
    );
    expect(principal.memberships).toEqual([{ role: "owner", tenantId }]);
  });

  it.each([
    ["missing", null],
    [
      "expired",
      {
        email: "owner@example.com",
        expiresAt: new Date("2026-08-12T13:59:59.000Z"),
        memberships: [{ role: "owner" as const, tenantId }],
        revokedAt: null,
        sessionId: "00000000-0000-4000-8000-000000000003",
        userId,
      },
    ],
    [
      "revoked",
      {
        email: "owner@example.com",
        expiresAt: new Date("2026-08-13T14:00:00.000Z"),
        memberships: [{ role: "owner" as const, tenantId }],
        revokedAt: new Date("2026-08-12T13:00:00.000Z"),
        sessionId: "00000000-0000-4000-8000-000000000003",
        userId,
      },
    ],
  ] as const)("rejects a %s session without touching it", async (_state, storedSession) => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findSessionByTokenHash).mockResolvedValue(storedSession);
    const service = new AuthenticateSessionService({
      clock: () => now,
      repository: dependencies.repository,
      sessionTokenHasher: dependencies.sessionTokenHasher,
    });

    await expect(service.execute("unusable-token")).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
    expect(dependencies.repository.touchSession).not.toHaveBeenCalled();
  });
});

describe("SignOutService and tenant authorization", () => {
  it("revokes the digest of the presented token and is safe to repeat", async () => {
    const dependencies = createDependencies();
    const service = new SignOutService({
      clock: () => now,
      repository: dependencies.repository,
      sessionTokenHasher: dependencies.sessionTokenHasher,
    });

    await service.execute("raw-session-token");

    expect(dependencies.repository.revokeSessionByTokenHash).toHaveBeenCalledWith(
      "c".repeat(64),
      now,
    );
  });

  it("allows an owner to act only inside a tenant in their principal", () => {
    const principal = {
      email: "owner@example.com",
      memberships: [{ role: "owner" as const, tenantId }],
      userId,
    };

    expect(() => requireTenantRole(principal, tenantId, "owner")).not.toThrow();
    expect(() =>
      requireTenantRole(
        principal,
        "00000000-0000-4000-8000-000000000099",
        "owner",
      ),
    ).toThrow(AuthorizationError);
  });
});
