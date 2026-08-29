import Fastify, { type FastifyInstance } from "fastify";
import { registerPublicAvailabilityRoutes } from "./availability/public-availability-route.js";
import type { GetPublicAvailabilityService } from "./availability/public-availability-service.js";
import { registerAvailabilityPolicyRoutes } from "./availability/policy-routes.js";
import type {
  GetTenantAvailabilityPolicyService,
  ReplaceTenantAvailabilityPolicyService,
} from "./availability/policy-services.js";
import type { RegisterOwnerService } from "./auth/register-owner.js";
import { registerRegistrationRoutes } from "./auth/registration-routes.js";
import { registerSessionRoutes } from "./auth/session-routes.js";
import type {
  AuthenticateSessionService,
  SignInService,
  SignOutService,
} from "./auth/session-services.js";
import type {
  DisconnectGoogleCalendarService,
  GetGoogleCalendarConnectionStatusService,
} from "./google/connection-services.js";
import { registerGoogleConnectionRoutes } from "./google/connection-routes.js";
import type { BeginGoogleOAuthService } from "./google/oauth-authorization.js";
import type { CompleteGoogleOAuthService } from "./google/oauth-callback.js";
import { registerGoogleOAuthRoutes } from "./google/oauth-routes.js";
import type { ReadinessCheck } from "./readiness.js";

export type { ReadinessCheck } from "./readiness.js";

export interface BuildAppOptions {
  availabilityPolicy?: {
    authenticateSession: Pick<AuthenticateSessionService, "execute">;
    getPolicy: Pick<GetTenantAvailabilityPolicyService, "execute">;
    replacePolicy: Pick<ReplaceTenantAvailabilityPolicyService, "execute">;
  };
  googleConnectionManagement?: {
    authenticateSession: Pick<AuthenticateSessionService, "execute">;
    disconnectGoogleCalendar: Pick<DisconnectGoogleCalendarService, "execute">;
    getConnectionStatus: Pick<
      GetGoogleCalendarConnectionStatusService,
      "execute"
    >;
  };
  googleOAuth?: {
    authenticateSession: Pick<AuthenticateSessionService, "execute">;
    beginGoogleOAuth: Pick<BeginGoogleOAuthService, "execute">;
    completeGoogleOAuth: Pick<CompleteGoogleOAuthService, "execute">;
  };
  logger?: boolean;
  publicAvailability?: {
    getAvailability: Pick<GetPublicAvailabilityService, "execute">;
  };
  readinessCheck: ReadinessCheck;
  registration?: {
    registerOwner: Pick<RegisterOwnerService, "execute">;
    secureCookies: boolean;
  };
  sessions?: {
    authenticateSession: Pick<AuthenticateSessionService, "execute">;
    secureCookies: boolean;
    signIn: Pick<SignInService, "execute">;
    signOut: Pick<SignOutService, "execute">;
  };
}

const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { type: "string", const: "ok" },
  },
} as const;

const readyResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { type: "string", enum: ["ready", "unavailable"] },
  },
} as const;

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  if (options.availabilityPolicy) {
    void app.register(registerAvailabilityPolicyRoutes, options.availabilityPolicy);
  }

  if (options.registration) {
    void app.register(registerRegistrationRoutes, options.registration);
  }

  if (options.sessions) {
    void app.register(registerSessionRoutes, options.sessions);
  }

  if (options.googleConnectionManagement) {
    void app.register(
      registerGoogleConnectionRoutes,
      options.googleConnectionManagement,
    );
  }

  if (options.googleOAuth) {
    void app.register(registerGoogleOAuthRoutes, options.googleOAuth);
  }

  if (options.publicAvailability) {
    void app.register(
      registerPublicAvailabilityRoutes,
      options.publicAvailability,
    );
  }

  app.get(
    "/health",
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/ready",
    {
      schema: {
        response: {
          200: readyResponseSchema,
          503: readyResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await options.readinessCheck();
        return { status: "ready" as const };
      } catch (error) {
        request.log.warn({ err: error }, "Readiness check failed");
        return reply.code(503).send({ status: "unavailable" as const });
      }
    },
  );

  return app;
}
