import { describe, expect, it, vi } from "vitest";
import {
  RegisterOwnerService,
  RegistrationValidationError,
  type OwnerRegistrationRepository,
  type PasswordHasher,
  type SessionTokenIssuer,
} from "../src/auth/register-owner.js";

const now = new Date("2026-08-12T12:00:00.000Z");
const thirtyDaysInMilliseconds = 30 * 24 * 60 * 60 * 1_000;

function createDependencies() {
  const repository: OwnerRegistrationRepository = {
    createOwnerRegistration: vi.fn(async () => ({
      tenantId: "00000000-0000-4000-8000-000000000002",
      userId: "00000000-0000-4000-8000-000000000001",
    })),
  };
  const passwordHasher: PasswordHasher = {
    hash: vi.fn(async () => "scrypt$stored-password-hash"),
  };
  const sessionTokenIssuer: SessionTokenIssuer = {
    issue: vi.fn(() => ({
      rawToken: "raw-session-token-returned-once",
      tokenHash: "a".repeat(64),
    })),
  };

  return { passwordHasher, repository, sessionTokenIssuer };
}

function validCommand() {
  return {
    email: " Owner@Example.COM ",
    locale: "es" as const,
    name: "  Example Owner  ",
    password: "correct horse battery staple",
    slug: "Example-Owner",
  };
}

describe("RegisterOwnerService", () => {
  it("creates an owner tenant and returns the raw session token once", async () => {
    const dependencies = createDependencies();
    const service = new RegisterOwnerService({
      ...dependencies,
      clock: () => now,
      sessionDurationMs: thirtyDaysInMilliseconds,
    });

    const result = await service.execute(validCommand());

    expect(dependencies.passwordHasher.hash).toHaveBeenCalledWith(
      "correct horse battery staple",
    );
    expect(dependencies.repository.createOwnerRegistration).toHaveBeenCalledWith({
      email: "owner@example.com",
      locale: "es",
      name: "Example Owner",
      passwordHash: "scrypt$stored-password-hash",
      sessionExpiresAt: new Date("2026-09-11T12:00:00.000Z"),
      sessionTokenHash: "a".repeat(64),
      slug: "example-owner",
    });
    expect(result).toEqual({
      email: "owner@example.com",
      expiresAt: new Date("2026-09-11T12:00:00.000Z"),
      sessionToken: "raw-session-token-returned-once",
      tenantId: "00000000-0000-4000-8000-000000000002",
      userId: "00000000-0000-4000-8000-000000000001",
    });
    expect(JSON.stringify(result)).not.toContain("stored-password-hash");
    expect(JSON.stringify(result)).not.toContain("a".repeat(64));
  });

  it("does not trim or normalize the password before hashing", async () => {
    const dependencies = createDependencies();
    const service = new RegisterOwnerService({
      ...dependencies,
      clock: () => now,
      sessionDurationMs: thirtyDaysInMilliseconds,
    });
    const password = "  fifteen chars or more  ";

    await service.execute({ ...validCommand(), password });

    expect(dependencies.passwordHasher.hash).toHaveBeenCalledWith(password);
  });

  it.each([
    ["email", { email: "not-an-email" }],
    ["name", { name: "   " }],
    ["password", { password: "too short" }],
    ["password", { password: "x".repeat(129) }],
    ["slug", { slug: "Not a valid slug!" }],
  ] as const)("rejects an invalid %s before using security or persistence adapters", async (field, override) => {
    const dependencies = createDependencies();
    const service = new RegisterOwnerService({
      ...dependencies,
      clock: () => now,
      sessionDurationMs: thirtyDaysInMilliseconds,
    });

    await expect(service.execute({ ...validCommand(), ...override })).rejects.toMatchObject({
      field,
      name: "RegistrationValidationError",
    } satisfies Partial<RegistrationValidationError>);
    expect(dependencies.passwordHasher.hash).not.toHaveBeenCalled();
    expect(dependencies.sessionTokenIssuer.issue).not.toHaveBeenCalled();
    expect(dependencies.repository.createOwnerRegistration).not.toHaveBeenCalled();
  });

  it("accepts a 15-character password without composition rules", async () => {
    const dependencies = createDependencies();
    const service = new RegisterOwnerService({
      ...dependencies,
      clock: () => now,
      sessionDurationMs: thirtyDaysInMilliseconds,
    });

    await expect(
      service.execute({ ...validCommand(), password: "lowercase words" }),
    ).resolves.toMatchObject({ email: "owner@example.com" });
  });
});
