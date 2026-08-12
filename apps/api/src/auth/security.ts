import { createHash, randomBytes as nodeRandomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { PasswordHasher, SessionTokenIssuer } from "./register-owner.js";
import type { SessionTokenHasher } from "./session-services.js";

export interface ScryptParameters {
  blockSize: number;
  cost: number;
  parallelization: number;
}

export const SCRYPT_PASSWORD_PARAMETERS: Readonly<ScryptParameters> = {
  cost: 131_072,
  blockSize: 8,
  parallelization: 1,
};

interface ScryptPasswordHasherOptions {
  parameters?: ScryptParameters;
  randomBytes?: (size: number) => Buffer;
}

const derivedKeyLength = 64;
const saltLength = 16;
const maximumMemoryBytes = 256 * 1024 * 1024;

function deriveKey(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      derivedKeyLength,
      {
        N: parameters.cost,
        p: parameters.parallelization,
        r: parameters.blockSize,
        maxmem: maximumMemoryBytes,
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

function isSafeStoredParameters(parameters: ScryptParameters): boolean {
  return (
    Number.isInteger(parameters.cost) &&
    parameters.cost >= 1_024 &&
    parameters.cost <= 1_048_576 &&
    (parameters.cost & (parameters.cost - 1)) === 0 &&
    Number.isInteger(parameters.blockSize) &&
    parameters.blockSize >= 1 &&
    parameters.blockSize <= 32 &&
    Number.isInteger(parameters.parallelization) &&
    parameters.parallelization >= 1 &&
    parameters.parallelization <= 16
  );
}

export class ScryptPasswordHasher implements PasswordHasher {
  private readonly parameters: ScryptParameters;
  private readonly randomBytes: (size: number) => Buffer;

  constructor(options: ScryptPasswordHasherOptions = {}) {
    this.parameters = options.parameters ?? SCRYPT_PASSWORD_PARAMETERS;
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;

    if (!isSafeStoredParameters(this.parameters)) {
      throw new Error("Invalid scrypt parameters.");
    }
  }

  async hash(password: string): Promise<string> {
    const salt = this.randomBytes(saltLength);
    const derivedKey = await deriveKey(password, salt, this.parameters);

    return [
      "scrypt",
      this.parameters.cost,
      this.parameters.blockSize,
      this.parameters.parallelization,
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") {
      return false;
    }

    const parameters: ScryptParameters = {
      cost: Number(parts[1]),
      blockSize: Number(parts[2]),
      parallelization: Number(parts[3]),
    };
    if (!isSafeStoredParameters(parameters)) {
      return false;
    }

    try {
      const salt = Buffer.from(parts[4] ?? "", "base64url");
      const expected = Buffer.from(parts[5] ?? "", "base64url");
      if (salt.length < 16 || expected.length !== derivedKeyLength) {
        return false;
      }

      const actual = await deriveKey(password, salt, parameters);
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}

export class RandomSessionTokenIssuer implements SessionTokenIssuer {
  constructor(
    private readonly randomBytes: (size: number) => Buffer = nodeRandomBytes,
  ) {}

  issue() {
    const rawToken = this.randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    return { rawToken, tokenHash };
  }
}

export class Sha256SessionTokenHasher implements SessionTokenHasher {
  hash(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }
}
