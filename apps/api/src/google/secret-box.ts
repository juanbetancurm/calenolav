import {
  createCipheriv,
  createDecipheriv,
  randomBytes as nodeRandomBytes,
} from "node:crypto";

export interface EncryptedSecret {
  authTag: string;
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

interface Aes256GcmSecretBoxOptions {
  currentKeyVersion: number;
  keys: ReadonlyMap<number, Buffer>;
  randomBytes?: (size: number) => Buffer;
}

export class SecretDecryptionError extends Error {
  override readonly name = "SecretDecryptionError";

  constructor() {
    super("Encrypted secret could not be opened.");
  }
}

const algorithm = "aes-256-gcm";
const authenticationTagLength = 16;
const encryptionKeyLength = 32;
const initializationVectorLength = 12;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;

export class Aes256GcmSecretBox {
  private readonly currentKeyVersion: number;
  private readonly keys: ReadonlyMap<number, Buffer>;
  private readonly randomBytes: (size: number) => Buffer;

  constructor(options: Aes256GcmSecretBoxOptions) {
    if (!Number.isInteger(options.currentKeyVersion) || options.currentKeyVersion <= 0) {
      throw new Error("Current encryption key version must be a positive integer.");
    }

    const copiedKeys = new Map<number, Buffer>();
    for (const [version, key] of options.keys) {
      if (!Number.isInteger(version) || version <= 0) {
        throw new Error("Encryption key versions must be positive integers.");
      }
      if (key.length !== encryptionKeyLength) {
        throw new Error("Encryption keys must contain exactly 32 bytes.");
      }
      copiedKeys.set(version, Buffer.from(key));
    }
    if (!copiedKeys.has(options.currentKeyVersion)) {
      throw new Error("Current encryption key version is not present in the key ring.");
    }

    this.currentKeyVersion = options.currentKeyVersion;
    this.keys = copiedKeys;
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;
  }

  encrypt(secret: string, context: string): EncryptedSecret {
    if (secret.length === 0) {
      throw new Error("Secret must not be empty.");
    }
    if (context.length === 0) {
      throw new Error("Encryption context must not be empty.");
    }

    const iv = this.randomBytes(initializationVectorLength);
    if (iv.length !== initializationVectorLength) {
      throw new Error("Random source must return exactly 12 bytes for an encryption IV.");
    }
    const key = this.keys.get(this.currentKeyVersion);
    if (!key) {
      throw new Error("Current encryption key version is not present in the key ring.");
    }

    const cipher = createCipheriv(algorithm, key, iv, {
      authTagLength: authenticationTagLength,
    });
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);

    return {
      authTag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      iv: iv.toString("base64url"),
      keyVersion: this.currentKeyVersion,
    };
  }

  decrypt(encrypted: EncryptedSecret, context: string): string {
    try {
      const key = this.keys.get(encrypted.keyVersion);
      if (
        !key ||
        context.length === 0 ||
        !base64UrlPattern.test(encrypted.ciphertext) ||
        !/^[A-Za-z0-9_-]{16}$/u.test(encrypted.iv) ||
        !/^[A-Za-z0-9_-]{22}$/u.test(encrypted.authTag)
      ) {
        throw new SecretDecryptionError();
      }

      const iv = Buffer.from(encrypted.iv, "base64url");
      const authTag = Buffer.from(encrypted.authTag, "base64url");
      if (
        iv.length !== initializationVectorLength ||
        authTag.length !== authenticationTagLength
      ) {
        throw new SecretDecryptionError();
      }

      const decipher = createDecipheriv(algorithm, key, iv, {
        authTagLength: authenticationTagLength,
      });
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SecretDecryptionError();
    }
  }
}
