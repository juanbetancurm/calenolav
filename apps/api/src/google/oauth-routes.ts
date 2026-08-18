import cookie from "@fastify/cookie";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { SESSION_COOKIE_NAME } from "../auth/session-routes.js";
import {
  AuthorizationError,
  InvalidSessionError,
  type AuthenticateSessionService,
} from "../auth/session-services.js";
import type { BeginGoogleOAuthService } from "./oauth-authorization.js";

interface GoogleOAuthRoutesOptions {
  authenticateSession: Pick<AuthenticateSessionService, "execute">;
  beginGoogleOAuth: Pick<BeginGoogleOAuthService, "execute">;
}

interface TenantParameters {
  tenantId: string;
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
