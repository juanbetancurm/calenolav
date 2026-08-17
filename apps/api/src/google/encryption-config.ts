type Environment = Readonly<Record<string, string | undefined>>;

export interface EncryptionKeyRingConfig {
  currentKeyVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

function parsePositiveInteger(value: string): number | null {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function readEncryptionKeyRingConfig(
  environment: Environment = process.env,
): EncryptionKeyRingConfig {
  const rawCurrentVersion = environment.OAUTH_ENCRYPTION_CURRENT_KEY_VERSION?.trim();
  if (!rawCurrentVersion) {
    throw new Error("OAUTH_ENCRYPTION_CURRENT_KEY_VERSION is required.");
  }

  const rawKeyRing = environment.OAUTH_ENCRYPTION_KEYS?.trim();
  if (!rawKeyRing) {
    throw new Error("OAUTH_ENCRYPTION_KEYS is required.");
  }

  const currentKeyVersion = parsePositiveInteger(rawCurrentVersion);
  if (currentKeyVersion === null) {
    throw new Error("Current encryption key version must be a positive integer.");
  }

  const keys = new Map<number, Buffer>();
  for (const rawEntry of rawKeyRing.split(",")) {
    const match = /^([1-9][0-9]*):([A-Za-z0-9_-]+)$/u.exec(rawEntry.trim());
    if (!match) {
      throw new Error(
        "Each OAUTH_ENCRYPTION_KEYS entry must use version:base64url format.",
      );
    }

    const versionText = match[1];
    const encodedKey = match[2];
    if (!versionText || !encodedKey) {
      throw new Error(
        "Each OAUTH_ENCRYPTION_KEYS entry must use version:base64url format.",
      );
    }
    const version = parsePositiveInteger(versionText);
    if (version === null) {
      throw new Error("Encryption key versions must be positive integers.");
    }
    if (keys.has(version)) {
      throw new Error("OAUTH_ENCRYPTION_KEYS contains a duplicate version.");
    }

    const key = Buffer.from(encodedKey, "base64url");
    if (key.toString("base64url") !== encodedKey) {
      throw new Error("OAuth encryption keys must use canonical unpadded base64url.");
    }
    if (key.length !== 32) {
      throw new Error("Every OAuth encryption key must decode to exactly 32 bytes.");
    }
    keys.set(version, key);
  }

  if (!keys.has(currentKeyVersion)) {
    throw new Error("Current OAuth encryption key version is not present in the key ring.");
  }

  return { currentKeyVersion, keys };
}
