import { describe, expect, it } from "vitest";
import { readEncryptionKeyRingConfig } from "../src/google/encryption-config.js";

const version1Key = Buffer.alloc(32, 17).toString("base64url");
const version2Key = Buffer.alloc(32, 29).toString("base64url");

describe("Google encryption key-ring configuration", () => {
  it("loads a current key and older decryption keys", () => {
    const config = readEncryptionKeyRingConfig({
      OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "2",
      OAUTH_ENCRYPTION_KEYS: `1:${version1Key},2:${version2Key}`,
    });

    expect(config.currentKeyVersion).toBe(2);
    expect(config.keys).toEqual(
      new Map([
        [1, Buffer.alloc(32, 17)],
        [2, Buffer.alloc(32, 29)],
      ]),
    );
  });

  it.each([
    {
      name: "missing current version",
      environment: { OAUTH_ENCRYPTION_KEYS: `1:${version1Key}` },
      message: "OAUTH_ENCRYPTION_CURRENT_KEY_VERSION is required.",
    },
    {
      name: "missing key ring",
      environment: { OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "1" },
      message: "OAUTH_ENCRYPTION_KEYS is required.",
    },
    {
      name: "non-positive current version",
      environment: {
        OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "0",
        OAUTH_ENCRYPTION_KEYS: `1:${version1Key}`,
      },
      message: "Current encryption key version must be a positive integer.",
    },
    {
      name: "malformed key entry",
      environment: {
        OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "1",
        OAUTH_ENCRYPTION_KEYS: "not-a-versioned-key",
      },
      message: "Each OAUTH_ENCRYPTION_KEYS entry must use version:base64url format.",
    },
    {
      name: "duplicate key version",
      environment: {
        OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "1",
        OAUTH_ENCRYPTION_KEYS: `1:${version1Key},1:${version2Key}`,
      },
      message: "OAUTH_ENCRYPTION_KEYS contains a duplicate version.",
    },
    {
      name: "wrong decoded key length",
      environment: {
        OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "1",
        OAUTH_ENCRYPTION_KEYS: `1:${Buffer.alloc(31).toString("base64url")}`,
      },
      message: "Every OAuth encryption key must decode to exactly 32 bytes.",
    },
    {
      name: "current version absent from ring",
      environment: {
        OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "2",
        OAUTH_ENCRYPTION_KEYS: `1:${version1Key}`,
      },
      message: "Current OAuth encryption key version is not present in the key ring.",
    },
  ])("rejects $name", ({ environment, message }) => {
    expect(() => readEncryptionKeyRingConfig(environment)).toThrow(message);
  });

  it("rejects non-canonical base64url without exposing the supplied value", () => {
    const malformedKey = `${version1Key.slice(0, -1)}B`;
    let caught: unknown;

    try {
      readEncryptionKeyRingConfig({
        OAUTH_ENCRYPTION_CURRENT_KEY_VERSION: "1",
        OAUTH_ENCRYPTION_KEYS: `1:${malformedKey}`,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      "OAuth encryption keys must use canonical unpadded base64url.",
    );
    expect((caught as Error).message).not.toContain(malformedKey);
  });
});
