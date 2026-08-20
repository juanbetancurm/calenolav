import cookie from "@fastify/cookie";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { SESSION_COOKIE_NAME } from "../auth/session-routes.js";
import {
  AuthorizationError,
  InvalidSessionError,
  type AuthenticateSessionService,
} from "../auth/session-services.js";
import type { BeginGoogleOAuthService } from "./oauth-authorization.js";
import {
  GoogleOAuthCallbackError,
  type CompleteGoogleOAuthService,
} from "./oauth-callback.js";

interface GoogleOAuthRoutesOptions {
  authenticateSession: Pick<AuthenticateSessionService, "execute">;
  beginGoogleOAuth: Pick<BeginGoogleOAuthService, "execute">;
  completeGoogleOAuth?: Pick<CompleteGoogleOAuthService, "execute">;
}

interface TenantParameters {
  tenantId: string;
}

interface GoogleOAuthCallbackQuery {
  code?: string;
  error?: string;
  state?: string;
}

const tenantParametersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tenantId"],
  properties: {
    tenantId: {
      type: "string",
      pattern:
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    },
  },
} as const;

function protectOAuthResponse(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Referrer-Policy", "no-referrer");
}

export const registerGoogleOAuthRoutes: FastifyPluginAsync<
  GoogleOAuthRoutesOptions
> = async (app, options) => {
  await app.register(cookie);

  const completeGoogleOAuth = options.completeGoogleOAuth;
  if (completeGoogleOAuth) {
    app.get<{ Querystring: GoogleOAuthCallbackQuery }>(
      "/google/oauth/callback",
      async (request, reply) => {
        protectOAuthResponse(reply);
        const { code, error, state } = request.query;
        if (
          typeof error === "string" ||
          typeof code !== "string" ||
          code.trim().length === 0 ||
          typeof state !== "string" ||
          state.trim().length === 0
        ) {
          return reply
            .code(400)
            .send({ error: { code: "google_oauth_callback_failed" } });
        }

        try {
          const result = await completeGoogleOAuth.execute({ code, state });
          return reply.code(200).send({
            data: { status: "connected" as const, tenantId: result.tenantId },
          });
        } catch (callbackError) {
          if (callbackError instanceof GoogleOAuthCallbackError) {
            return reply
              .code(400)
              .send({ error: { code: "google_oauth_callback_failed" } });
          }
          throw callbackError;
        }
      },
    );
  }

  app.post<{ Params: TenantParameters }>(
    "/tenants/:tenantId/google/oauth/start",
    { schema: { params: tenantParametersSchema } },
    async (request, reply) => {
      protectOAuthResponse(reply);
      const rawToken = request.cookies[SESSION_COOKIE_NAME];
      if (!rawToken) {
        return reply.code(401).send({ error: { code: "invalid_session" } });
      }

      try {
        const principal = await options.authenticateSession.execute(rawToken);
        const result = await options.beginGoogleOAuth.execute({
          principal,
          tenantId: request.params.tenantId,
        });

        return reply
          .code(303)
          .header("Location", result.authorizationUrl)
          .send();
      } catch (error) {
        if (error instanceof InvalidSessionError) {
          return reply.code(401).send({ error: { code: "invalid_session" } });
        }
        if (error instanceof AuthorizationError) {
          return reply.code(403).send({ error: { code: "forbidden" } });
        }
        throw error;
      }
    },
  );
};
