import cookie from "@fastify/cookie";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { SESSION_COOKIE_NAME } from "../auth/session-routes.js";
import {
  AuthorizationError,
  InvalidSessionError,
  type AuthenticateSessionService,
} from "../auth/session-services.js";
import type {
  DisconnectGoogleCalendarService,
  GetGoogleCalendarConnectionStatusService,
} from "./connection-services.js";

interface GoogleConnectionRoutesOptions {
  authenticateSession: Pick<AuthenticateSessionService, "execute">;
  disconnectGoogleCalendar: Pick<DisconnectGoogleCalendarService, "execute">;
  getConnectionStatus: Pick<
    GetGoogleCalendarConnectionStatusService,
    "execute"
  >;
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

function protectConnectionResponse(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Referrer-Policy", "no-referrer");
}

export const registerGoogleConnectionRoutes: FastifyPluginAsync<
  GoogleConnectionRoutesOptions
> = async (app, options) => {
  await app.register(cookie);

  app.get<{ Params: TenantParameters }>(
    "/tenants/:tenantId/google/connection",
    { schema: { params: tenantParametersSchema } },
    async (request, reply) => {
      protectConnectionResponse(reply);
      const rawToken = request.cookies[SESSION_COOKIE_NAME];
      if (!rawToken) {
        return reply.code(401).send({ error: { code: "invalid_session" } });
      }

      try {
        const principal = await options.authenticateSession.execute(rawToken);
        const status = await options.getConnectionStatus.execute({
          principal,
          tenantId: request.params.tenantId,
        });
        return reply.code(200).send({ data: status });
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

  app.delete<{ Params: TenantParameters }>(
    "/tenants/:tenantId/google/connection",
    { schema: { params: tenantParametersSchema } },
    async (request, reply) => {
      protectConnectionResponse(reply);
      const rawToken = request.cookies[SESSION_COOKIE_NAME];
      if (!rawToken) {
        return reply.code(401).send({ error: { code: "invalid_session" } });
      }

      try {
        const principal = await options.authenticateSession.execute(rawToken);
        await options.disconnectGoogleCalendar.execute({
          principal,
          tenantId: request.params.tenantId,
        });
        return reply.code(204).send();
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
