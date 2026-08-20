import { Pool } from "pg";
import { buildApp } from "./app.js";
import { PostgresOwnerRegistrationRepository } from "./auth/postgres-owner-registration.js";
import { PostgresSessionRepository } from "./auth/postgres-session-repository.js";
import { RegisterOwnerService } from "./auth/register-owner.js";
import {
  RandomSessionTokenIssuer,
  ScryptPasswordHasher,
  Sha256SessionTokenHasher,
} from "./auth/security.js";
import {
  AuthenticateSessionService,
  SignInService,
  SignOutService,
} from "./auth/session-services.js";
import { loadEnvironmentFile, readConfig } from "./config.js";
import { BeginGoogleOAuthService } from "./google/oauth-authorization.js";
import { CompleteGoogleOAuthService } from "./google/oauth-callback.js";
import { GoogleOAuthCodeClient } from "./google/google-oauth-client.js";
import { PostgresGoogleOAuthAttemptRepository } from "./google/postgres-oauth-attempt-repository.js";
import { PostgresGoogleOAuthCallbackRepository } from "./google/postgres-oauth-callback-repository.js";
import { Aes256GcmSecretBox } from "./google/secret-box.js";
import { createPostgresReadinessCheck } from "./readiness.js";

loadEnvironmentFile();
const config = readConfig();

const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  max: 10,
});

const clock = () => new Date();
const sessionDurationMs = 30 * 24 * 60 * 60 * 1_000;
const passwordHasher = new ScryptPasswordHasher();
const sessionTokenIssuer = new RandomSessionTokenIssuer();
const sessionTokenHasher = new Sha256SessionTokenHasher();
const sessionRepository = new PostgresSessionRepository(pool);
const dummyPasswordHash = await passwordHasher.hash(
  "dummy password used only to equalize sign-in work",
);

const registerOwner = new RegisterOwnerService({
  clock,
  passwordHasher,
  repository: new PostgresOwnerRegistrationRepository(pool),
  sessionDurationMs,
  sessionTokenIssuer,
});
const signIn = new SignInService({
  clock,
  dummyPasswordHash,
  passwordVerifier: passwordHasher,
  repository: sessionRepository,
  sessionDurationMs,
  sessionTokenIssuer,
});
const authenticateSession = new AuthenticateSessionService({
  clock,
  repository: sessionRepository,
  sessionTokenHasher,
});
const signOut = new SignOutService({
  clock,
  repository: sessionRepository,
  sessionTokenHasher,
});
const googleOAuthConfig = config.googleOAuth;
const googleOAuth = googleOAuthConfig
  ? (() => {
      const secretBox = new Aes256GcmSecretBox(
        googleOAuthConfig.encryptionKeyRing,
      );
      return {
        authenticateSession,
        beginGoogleOAuth: new BeginGoogleOAuthService({
          attemptDurationMs: 10 * 60 * 1_000,
          clientId: googleOAuthConfig.clientId,
          clock,
          redirectUri: googleOAuthConfig.redirectUri,
          repository: new PostgresGoogleOAuthAttemptRepository(pool),
          secretEncryptor: secretBox,
        }),
        completeGoogleOAuth: new CompleteGoogleOAuthService({
          clock,
          googleClient: new GoogleOAuthCodeClient({
            clientId: googleOAuthConfig.clientId,
            clientSecret: googleOAuthConfig.clientSecret,
            redirectUri: googleOAuthConfig.redirectUri,
          }),
          repository: new PostgresGoogleOAuthCallbackRepository(pool),
          secretBox,
        }),
      };
    })()
  : null;

const app = buildApp({
  ...(googleOAuth ? { googleOAuth } : {}),
  logger: true,
  readinessCheck: createPostgresReadinessCheck(async (statement) => pool.query(statement)),
  registration: {
    registerOwner,
    secureCookies: config.secureCookies,
  },
  sessions: {
    authenticateSession,
    secureCookies: config.secureCookies,
    signIn,
    signOut,
  },
});

app.addHook("onClose", async () => {
  await pool.end();
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "Shutting down API");
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "API shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, "API startup failed");
  await app.close();
  process.exitCode = 1;
}
