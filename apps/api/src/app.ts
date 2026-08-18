import Fastify, { type FastifyInstance } from "fastify";
import type { RegisterOwnerService } from "./auth/register-owner.js";
import { registerRegistrationRoutes } from "./auth/registration-routes.js";
import { registerSessionRoutes } from "./auth/session-routes.js";
import type {
  AuthenticateSessionService,
  SignInService,
  SignOutService,
} from "./auth/session-services.js";
import type { BeginGoogleOAuthService } from "./google/oauth-authorization.js";
import { registerGoogleOAuthRoutes } from "./google/oauth-routes.js";
import type { ReadinessCheck } from "./readiness.js";

export type { ReadinessCheck } from "./readiness.js";

export interface BuildAppOptions {
  googleOAuth?: {
    authenticateSession: Pick<AuthenticateSessionService, "execute">;
    beginGoogleOAuth: Pick<BeginGoogleOAuthService, "execute">;
  };
  logger?: boolean;
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

  if (options.registration) {
    void app.register(registerRegistrationRoutes, options.registration);
  }

  if (options.sessions) {
    void app.register(registerSessionRoutes, options.sessions);
  }

  if (options.googleOAuth) {
    void app.register(registerGoogleOAuthRoutes, options.googleOAuth);
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
