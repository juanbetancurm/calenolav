import { createHash } from "node:crypto";
import { GOOGLE_CALENDAR_SCOPES } from "./oauth-authorization.js";
import type { EncryptedSecret } from "./secret-box.js";

export interface ConsumedGoogleOAuthAttempt {
  codeVerifier: EncryptedSecret;
  expiresAt: Date;
  stateHash: string;
  tenantId: string;
  userId: string;
}

export interface NewGoogleCalendarConnection {
  calendarId: string;
  googleAccountEmail: string;
  googleSubject: string;
  grantedScopes: string[];
  refreshToken: EncryptedSecret;
  tenantId: string;
}

export interface GoogleOAuthCallbackRepository {
  consumeAttempt(stateHash: string): Promise<ConsumedGoogleOAuthAttempt | null>;
  saveConnection(connection: NewGoogleCalendarConnection): Promise<void>;
}

export interface GoogleCodeExchangeResult {
  grantedScopes: string[];
  identity: {
    email: string;
    emailVerified: boolean;
    subject: string;
  };
  refreshToken: string | null;
}

export interface GoogleAuthorizationCodeClient {
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<GoogleCodeExchangeResult>;
}

export interface OAuthSecretBox {
  decrypt(encrypted: EncryptedSecret, context: string): string;
  encrypt(secret: string, context: string): EncryptedSecret;
}

interface CompleteGoogleOAuthDependencies {
  clock: () => Date;
  googleClient: GoogleAuthorizationCodeClient;
  repository: GoogleOAuthCallbackRepository;
  secretBox: OAuthSecretBox;
}

export interface CompleteGoogleOAuthCommand {
  code: string;
  state: string;
}

export interface CompleteGoogleOAuthResult {
  tenantId: string;
}

export class GoogleOAuthCallbackError extends Error {
  override readonly name = "GoogleOAuthCallbackError";

  constructor() {
    super("Google Calendar connection could not be completed.");
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function hashState(rawState: string): string {
  return createHash("sha256").update(rawState).digest("hex");
}

export class CompleteGoogleOAuthService {
  constructor(private readonly dependencies: CompleteGoogleOAuthDependencies) {}

  async execute(
    command: CompleteGoogleOAuthCommand,
  ): Promise<CompleteGoogleOAuthResult> {
    if (command.code.trim().length === 0 || command.state.trim().length === 0) {
      throw new GoogleOAuthCallbackError();
    }

    const stateHash = hashState(command.state);

    try {
      const attempt = await this.dependencies.repository.consumeAttempt(stateHash);
      const now = this.dependencies.clock();
      if (
        !attempt ||
        attempt.stateHash !== stateHash ||
        !Number.isFinite(attempt.expiresAt.getTime()) ||
        attempt.expiresAt.getTime() <= now.getTime()
      ) {
        throw new GoogleOAuthCallbackError();
      }

      const codeVerifier = this.dependencies.secretBox.decrypt(
        attempt.codeVerifier,
        `google-oauth-code-verifier:${attempt.tenantId}:${stateHash}`,
      );
      if (codeVerifier.length === 0) {
        throw new GoogleOAuthCallbackError();
      }

      const exchange = await this.dependencies.googleClient.exchangeCode({
        code: command.code,
        codeVerifier,
      });
      const refreshToken = exchange.refreshToken;
      const googleSubject = exchange.identity.subject.trim();
      const googleAccountEmail = exchange.identity.email.trim().toLowerCase();
      const grantedScopes = [
        ...new Set(exchange.grantedScopes.map((scope) => scope.trim()).filter(Boolean)),
      ];
      const hasRequiredScopes = GOOGLE_CALENDAR_SCOPES.every((scope) =>
        grantedScopes.includes(scope),
      );

      if (
        !refreshToken ||
        refreshToken.trim().length === 0 ||
        !exchange.identity.emailVerified ||
        googleSubject.length === 0 ||
        googleSubject.length > 255 ||
        googleAccountEmail.length > 320 ||
        !emailPattern.test(googleAccountEmail) ||
        !hasRequiredScopes
      ) {
        throw new GoogleOAuthCallbackError();
      }

      const encryptedRefreshToken = this.dependencies.secretBox.encrypt(
        refreshToken,
        `google-refresh-token:${attempt.tenantId}`,
      );
      await this.dependencies.repository.saveConnection({
        calendarId: "primary",
        googleAccountEmail,
        googleSubject,
        grantedScopes,
        refreshToken: encryptedRefreshToken,
        tenantId: attempt.tenantId,
      });

      return { tenantId: attempt.tenantId };
    } catch {
      throw new GoogleOAuthCallbackError();
    }
  }
}
