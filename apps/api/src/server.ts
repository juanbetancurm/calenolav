import { Pool } from "pg";
import { buildApp } from "./app.js";
import {
  GetTenantAvailabilityPolicyService,
  ReplaceTenantAvailabilityPolicyService,
} from "./availability/policy-services.js";
import { PostgresAvailabilityPolicyRepository } from "./availability/postgres-policy-repository.js";
import { PostgresPublicAvailabilityRepository } from "./availability/postgres-public-availability-repository.js";
import { GetPublicAvailabilityService } from "./availability/public-availability-service.js";
import { CreateBookingService } from "./booking/create-booking-service.js";
import {
  BookingReconciliationRunner,
  systemReconciliationTimer,
} from "./booking/booking-reconciliation-runner.js";
import { PostgresBookingRepository } from "./booking/postgres-booking-repository.js";
import { ReconcilePendingBookingsService } from "./booking/reconcile-pending-bookings.js";
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
import {
  DisconnectGoogleCalendarService,
  GetGoogleCalendarConnectionStatusService,
} from "./google/connection-services.js";
import { BeginGoogleOAuthService } from "./google/oauth-authorization.js";
import { CompleteGoogleOAuthService } from "./google/oauth-callback.js";
import { GoogleCalendarEventClient } from "./google/google-event-client.js";
import { GoogleCalendarFreeBusyClient } from "./google/google-freebusy-client.js";
import { GoogleOAuthCodeClient } from "./google/google-oauth-client.js";
import { PostgresGoogleCalendarConnectionManagementRepository } from "./google/postgres-connection-management-repository.js";
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
const availabilityPolicyRepository = new PostgresAvailabilityPolicyRepository(pool);
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
const googleConnectionRepository =
  new PostgresGoogleCalendarConnectionManagementRepository(pool);
const googleOAuthConfig = config.googleOAuth;
const googleOAuthRuntime = googleOAuthConfig
  ? (() => {
      const secretBox = new Aes256GcmSecretBox(
        googleOAuthConfig.encryptionKeyRing,
      );
      const googleClient = new GoogleOAuthCodeClient({
        clientId: googleOAuthConfig.clientId,
        clientSecret: googleOAuthConfig.clientSecret,
        redirectUri: googleOAuthConfig.redirectUri,
      });
      const freeBusyClient = new GoogleCalendarFreeBusyClient({
        clientId: googleOAuthConfig.clientId,
        clientSecret: googleOAuthConfig.clientSecret,
      });
      const eventClient = new GoogleCalendarEventClient({
        clientId: googleOAuthConfig.clientId,
        clientSecret: googleOAuthConfig.clientSecret,
      });
      const publicAvailabilityRepository =
        new PostgresPublicAvailabilityRepository(pool);
      const bookingRepository = new PostgresBookingRepository(pool);
      return {
        bookingReconciliation: new ReconcilePendingBookingsService({
          batchSize: config.bookingReconciliation.batchSize,
          clock,
          eventClient,
          repository: bookingRepository,
          retryDelayMs: config.bookingReconciliation.retryDelayMs,
          secretBox,
        }),
        disconnectDependencies: {
          grantRevoker: googleClient,
          secretBox,
        },
        routes: {
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
            googleClient,
            repository: new PostgresGoogleOAuthCallbackRepository(pool),
            secretBox,
          }),
        },
        publicAvailability: {
          getAvailability: new GetPublicAvailabilityService({
            clock,
            freeBusyClient,
            repository: publicAvailabilityRepository,
            secretBox,
          }),
        },
        publicBooking: {
          createBooking: new CreateBookingService({
            availabilityRepository: publicAvailabilityRepository,
            bookingRepository,
            clock,
            eventClient,
            freeBusyClient,
            secretBox,
          }),
        },
      };
    })()
  : null;
const googleConnectionManagement = {
  authenticateSession,
  disconnectGoogleCalendar: new DisconnectGoogleCalendarService({
    repository: googleConnectionRepository,
    ...(googleOAuthRuntime?.disconnectDependencies ?? {}),
  }),
  getConnectionStatus: new GetGoogleCalendarConnectionStatusService({
    repository: googleConnectionRepository,
  }),
};

const availabilityPolicy = {
  authenticateSession,
  getPolicy: new GetTenantAvailabilityPolicyService({
    repository: availabilityPolicyRepository,
  }),
  replacePolicy: new ReplaceTenantAvailabilityPolicyService({
    repository: availabilityPolicyRepository,
  }),
};

const app = buildApp({
  availabilityPolicy,
  googleConnectionManagement,
  ...(googleOAuthRuntime ? { googleOAuth: googleOAuthRuntime.routes } : {}),
  ...(googleOAuthRuntime
    ? { publicAvailability: googleOAuthRuntime.publicAvailability }
    : {}),
  ...(googleOAuthRuntime
    ? { publicBooking: googleOAuthRuntime.publicBooking }
    : {}),
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

const bookingReconciliationRunner = googleOAuthRuntime
  ? new BookingReconciliationRunner({
      ...systemReconciliationTimer,
      intervalMs: config.bookingReconciliation.intervalMs,
      logger: app.log,
      reconcilePendingBookings: googleOAuthRuntime.bookingReconciliation,
    })
  : null;

app.addHook("onClose", async () => {
  await bookingReconciliationRunner?.stop();
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
  bookingReconciliationRunner?.start();
} catch (error) {
  app.log.error({ err: error }, "API startup failed");
  await app.close();
  process.exitCode = 1;
}
