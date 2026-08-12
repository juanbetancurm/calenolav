import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RandomSessionTokenIssuer,
  SCRYPT_PASSWORD_PARAMETERS,
  ScryptPasswordHasher,
} from "../src/auth/security.js";

describe("authentication security adapters", () => {
  it("records the OWASP scrypt work factors as upgradable hash metadata", () => {
    expect(SCRYPT_PASSWORD_PARAMETERS).toEqual({
      cost: 131_072,
      blockSize: 8,
      parallelization: 1,
    });
  });

  it("salts and verifies passwords without storing the password", async () => {
    const hasher = new ScryptPasswordHasher({
      parameters: { cost: 1_024, blockSize: 8, parallelization: 1 },
      randomBytes: (size) => Buffer.alloc(size, 7),
    });
    const password = "correct horse battery staple";

    const storedHash = await hasher.hash(password);

    expect(storedHash).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    expect(storedHash).not.toContain(password);
    await expect(hasher.verify(password, storedHash)).resolves.toBe(true);
    await expect(hasher.verify("a different long password", storedHash)).resolves.toBe(false);
  });

  it("issues a 256-bit opaque token and stores only its SHA-256 digest", () => {
    const randomTokenBytes = Buffer.alloc(32, 11);
    const issuer = new RandomSessionTokenIssuer(() => randomTokenBytes);

    const issued = issuer.issue();

    expect(Buffer.from(issued.rawToken, "base64url")).toEqual(randomTokenBytes);
    expect(issued.tokenHash).toBe(
      createHash("sha256").update(issued.rawToken).digest("hex"),
    );
    expect(issued.tokenHash).toHaveLength(64);
    expect(issued.tokenHash).not.toContain(issued.rawToken);
  });
});
