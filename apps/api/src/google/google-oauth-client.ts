import { OAuth2Client } from "google-auth-library";
import type {
  GoogleAuthorizationCodeClient,
  GoogleCodeExchangeResult,
} from "./oauth-callback.js";

interface GoogleTokenResponse {
  id_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
}

interface GoogleIdentityPayload {
  email?: string;
  email_verified?: boolean;
  sub?: string;
}

interface GoogleIdentityTicket {
  getPayload(): GoogleIdentityPayload | undefined;
}

interface GoogleOAuthSdkClient {
  getToken(input: {
    code: string;
    codeVerifier: string;
  }): Promise<{ tokens: GoogleTokenResponse }>;
  revokeToken(token: string): Promise<unknown>;
  verifyIdToken(input: {
    audience: string;
    idToken: string;
  }): Promise<GoogleIdentityTicket>;
}

interface GoogleOAuthClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type GoogleOAuthClientFactory = (
  options: GoogleOAuthClientOptions,
) => GoogleOAuthSdkClient;

export interface GoogleOAuthCodeClientDependencies
  extends GoogleOAuthClientOptions {
  clientFactory?: GoogleOAuthClientFactory;
}

export class GoogleOAuthProtocolError extends Error {
  override readonly name = "GoogleOAuthProtocolError";

  constructor() {
    super("Google OAuth response could not be verified.");
  }
}

function createOfficialClient(
  options: GoogleOAuthClientOptions,
): GoogleOAuthSdkClient {
  const client = new OAuth2Client(options);

  return {
    getToken: (input) => client.getToken(input),
    revokeToken: (token) => client.revokeToken(token),
    verifyIdToken: (input) => client.verifyIdToken(input),
  };
}

function requireConfiguration(value: string, message: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(message);
  }

  return normalized;
}

function readGrantedScopes(scope: string | null | undefined): string[] {
  return [
    ...new Set(
      (scope ?? "")
        .split(/\s+/u)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export class GoogleOAuthCodeClient implements GoogleAuthorizationCodeClient {
  private readonly client: GoogleOAuthSdkClient;
  private readonly clientId: string;

  constructor(dependencies: GoogleOAuthCodeClientDependencies) {
    this.clientId = requireConfiguration(
      dependencies.clientId,
      "Google OAuth client ID is required.",
    );
    const clientSecret = requireConfiguration(
      dependencies.clientSecret,
      "Google OAuth client secret is required.",
    );
    const redirectUri = requireConfiguration(
      dependencies.redirectUri,
      "Google OAuth redirect URI is required.",
    );
    const clientFactory = dependencies.clientFactory ?? createOfficialClient;

    try {
      this.client = clientFactory({
        clientId: this.clientId,
        clientSecret,
        redirectUri,
      });
    } catch {
      throw new Error("Google OAuth client could not be initialized.");
    }
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<GoogleCodeExchangeResult> {
    try {
      const { tokens } = await this.client.getToken({
        code: input.code,
        codeVerifier: input.codeVerifier,
      });
      const idToken = tokens.id_token;
      if (!idToken) {
        throw new GoogleOAuthProtocolError();
      }

      const ticket = await this.client.verifyIdToken({
        audience: this.clientId,
        idToken,
      });
      const payload = ticket.getPayload();
      const email = payload?.email?.trim();
      const subject = payload?.sub?.trim();
      if (!email || !subject) {
        throw new GoogleOAuthProtocolError();
      }

      return {
        grantedScopes: readGrantedScopes(tokens.scope),
        identity: {
          email,
          emailVerified: payload?.email_verified === true,
          subject,
        },
        refreshToken: tokens.refresh_token ?? null,
      };
    } catch {
      throw new GoogleOAuthProtocolError();
    }
  }

  async revokeGrant(refreshToken: string): Promise<void> {
    try {
      await this.client.revokeToken(refreshToken);
    } catch {
      throw new GoogleOAuthProtocolError();
    }
  }
}
