import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import {
  requireTenantRole,
  type AuthenticatedPrincipal,
} from "../auth/session-services.js";
import type { EncryptedSecret } from "./secret-box.js";

export const GOOGLE_CALENDAR_FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.freebusy";

export const GOOGLE_CALENDAR_SCOPES = [
  GOOGLE_CALENDAR_FREEBUSY_SCOPE,
  "https://www.googleapis.com/auth/calendar.events.owned",
] as const;

export const GOOGLE_IDENTITY_SCOPES = ["openid", "email"] as const;

export const GOOGLE_OAUTH_SCOPES = [
  ...GOOGLE_IDENTITY_SCOPES,
  ...GOOGLE_CALENDAR_SCOPES,
] as const;

export interface SecretEncryptor {
  encrypt(secret: string, context: string): EncryptedSecret;
}

export interface NewGoogleOAuthAttempt {
  codeVerifier: EncryptedSecret;
  expiresAt: Date;
  stateHash: string;
  tenantId: string;
  userId: string;
}

export interface GoogleOAuthAttemptRepository {
  createAttempt(attempt: NewGoogleOAuthAttempt): Promise<void>;
}

interface BeginGoogleOAuthDependencies {
  attemptDurationMs: number;
  clientId: string;
  clock: () => Date;
  randomBytes?: (size: number) => Buffer;
  redirectUri: string;
  repository: GoogleOAuthAttemptRepository;
  secretEncryptor: SecretEncryptor;
}

export interface BeginGoogleOAuthCommand {
  principal: AuthenticatedPrincipal;
  tenantId: string;
}

export interface BeginGoogleOAuthResult {
  authorizationUrl: string;
}

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const randomValueLength = 32;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function parseRedirectUri(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Google OAuth redirect URI must be a valid absolute URL.");
  }

  const isHttps = parsed.protocol === "https:";
  const isLocalHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (
    (!isHttps && !isLocalHttp) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      "Google OAuth redirect URI must use HTTPS, except for local loopback development.",
    );
  }

  return parsed.toString();
}

export class BeginGoogleOAuthService {
  private readonly attemptDurationMs: number;
  private readonly clientId: string;
  private readonly clock: () => Date;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly redirectUri: string;
  private readonly repository: GoogleOAuthAttemptRepository;
  private readonly secretEncryptor: SecretEncryptor;

  constructor(dependencies: BeginGoogleOAuthDependencies) {
    if (
      !Number.isFinite(dependencies.attemptDurationMs) ||
      dependencies.attemptDurationMs <= 0
    ) {
      throw new Error("attemptDurationMs must be a positive finite number.");
    }

    const clientId = dependencies.clientId.trim();
    if (clientId.length === 0) {
      throw new Error("Google OAuth client ID is required.");
    }

    this.attemptDurationMs = dependencies.attemptDurationMs;
    this.clientId = clientId;
    this.clock = dependencies.clock;
    this.randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
    this.redirectUri = parseRedirectUri(dependencies.redirectUri);
    this.repository = dependencies.repository;
    this.secretEncryptor = dependencies.secretEncryptor;
  }

  async execute(command: BeginGoogleOAuthCommand): Promise<BeginGoogleOAuthResult> {
    requireTenantRole(command.principal, command.tenantId, "owner");

    const stateBytes = this.randomBytes(randomValueLength);
    const verifierBytes = this.randomBytes(randomValueLength);
    if (
      stateBytes.length !== randomValueLength ||
      verifierBytes.length !== randomValueLength
    ) {
      throw new Error("OAuth random source must return exactly 32 bytes.");
    }

    const rawState = stateBytes.toString("base64url");
    const codeVerifier = verifierBytes.toString("base64url");
    const stateHash = sha256Hex(rawState);
    const codeChallenge = sha256Base64Url(codeVerifier);
    const encryptionContext =
      `google-oauth-code-verifier:${command.tenantId}:${stateHash}`;
    const encryptedCodeVerifier = this.secretEncryptor.encrypt(
      codeVerifier,
      encryptionContext,
    );
    const expiresAt = new Date(this.clock().getTime() + this.attemptDurationMs);

    await this.repository.createAttempt({
      codeVerifier: encryptedCodeVerifier,
      expiresAt,
      stateHash,
      tenantId: command.tenantId,
      userId: command.principal.userId,
    });

    const authorizationUrl = new URL(authorizationEndpoint);
    authorizationUrl.searchParams.set("client_id", this.clientId);
    authorizationUrl.searchParams.set("redirect_uri", this.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("include_granted_scopes", "true");
    authorizationUrl.searchParams.set("state", rawState);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    return { authorizationUrl: authorizationUrl.toString() };
  }
}
