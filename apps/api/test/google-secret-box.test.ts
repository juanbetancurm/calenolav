import { describe, expect, it } from "vitest";
import {
  Aes256GcmSecretBox,
  SecretDecryptionError,
  type EncryptedSecret,
} from "../src/google/secret-box.js";

const keyVersion1 = Buffer.alloc(32, 17);
const keyVersion2 = Buffer.alloc(32, 29);
const fixedIv = Buffer.from("000102030405060708090a0b", "hex");
const tenantContext = "google-refresh-token:00000000-0000-4000-8000-000000000001";
function changeFirstCharacter(value: string): string {
  return `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
}

function buildSecretBox(options: {
  currentKeyVersion?: number;
  keys?: ReadonlyMap<number, Buffer>;
  randomBytes?: (size: number) => Buffer;
} = {}) {
  return new Aes256GcmSecretBox({
    currentKeyVersion: options.currentKeyVersion ?? 2,
    keys: options.keys ?? new Map([[1, keyVersion1], [2, keyVersion2]]),
    randomBytes: options.randomBytes ?? (() => fixedIv),
  });
}

describe("AES-256-GCM secret box", () => {
  it("encrypts a secret into the database envelope and decrypts it", () => {
    const secretBox = buildSecretBox();
    const rawSecret = "raw-google-refresh-token";

    const encrypted = secretBox.encrypt(rawSecret, tenantContext);

    expect(encrypted).toMatchObject({
      authTag: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u),
      ciphertext: expect.stringMatching(/^[A-Za-z0-9_-]+$/u),
      iv: fixedIv.toString("base64url"),
      keyVersion: 2,
    });
    expect(JSON.stringify(encrypted)).not.toContain(rawSecret);
    expect(secretBox.decrypt(encrypted, tenantContext)).toBe(rawSecret);
  });

  it("uses a fresh IV so encrypting the same value does not repeat ciphertext", () => {
    let nextByte = 1;
    const secretBox = buildSecretBox({
      randomBytes: (size) => Buffer.alloc(size, nextByte++),
    });

    const first = secretBox.encrypt("same-secret", tenantContext);
    const second = secretBox.encrypt("same-secret", tenantContext);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("decrypts an older envelope after the current key rotates", () => {
    const oldSecretBox = buildSecretBox({
      currentKeyVersion: 1,
      keys: new Map([[1, keyVersion1]]),
    });
    const encryptedWithOldKey = oldSecretBox.encrypt("old-refresh-token", tenantContext);
    const rotatedSecretBox = buildSecretBox();

    expect(rotatedSecretBox.decrypt(encryptedWithOldKey, tenantContext)).toBe(
      "old-refresh-token",
    );
  });

  it("keeps a private copy of key material supplied by configuration", () => {
    const mutableKey = Buffer.from(keyVersion2);
    const secretBox = buildSecretBox({ keys: new Map([[2, mutableKey]]) });
    const encrypted = secretBox.encrypt("refresh-token", tenantContext);

    mutableKey.fill(0);

    expect(secretBox.decrypt(encrypted, tenantContext)).toBe("refresh-token");
  });
  it.each([
    {
      name: "modified ciphertext",
      mutate: (secret: EncryptedSecret): EncryptedSecret => ({
        ...secret,
        ciphertext: changeFirstCharacter(secret.ciphertext),
      }),
      context: tenantContext,
    },
    {
      name: "modified authentication tag",
      mutate: (secret: EncryptedSecret): EncryptedSecret => ({
        ...secret,
        authTag: changeFirstCharacter(secret.authTag),
      }),
      context: tenantContext,
    },
    {
      name: "different tenant context",
      mutate: (secret: EncryptedSecret): EncryptedSecret => secret,
      context: "google-refresh-token:another-tenant",
    },
    {
      name: "unknown key version",
      mutate: (secret: EncryptedSecret): EncryptedSecret => ({ ...secret, keyVersion: 99 }),
      context: tenantContext,
    },
    {
      name: "malformed IV",
      mutate: (secret: EncryptedSecret): EncryptedSecret => ({ ...secret, iv: "too-short" }),
      context: tenantContext,
    },
  ])("rejects $name with one generic error", ({ context, mutate }) => {
    const secretBox = buildSecretBox();
    const encrypted = secretBox.encrypt("secret-that-must-not-leak", tenantContext);

    expect(() => secretBox.decrypt(mutate(encrypted), context)).toThrow(
      SecretDecryptionError,
    );
    expect(() => secretBox.decrypt(mutate(encrypted), context)).toThrow(
      "Encrypted secret could not be opened.",
    );
  });

  it("rejects invalid key-ring configuration before encrypting", () => {
    expect(() =>
      buildSecretBox({ keys: new Map([[2, Buffer.alloc(31)]]) }),
    ).toThrow("Encryption keys must contain exactly 32 bytes");
    expect(() =>
      buildSecretBox({ currentKeyVersion: 3, keys: new Map([[2, keyVersion2]]) }),
    ).toThrow("Current encryption key version is not present");
  });
});
