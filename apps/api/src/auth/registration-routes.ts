import cookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import {
  RegistrationConflictError,
  RegistrationValidationError,
  type RegisterOwnerCommand,
  type RegisterOwnerService,
} from "./register-owner.js";

interface RegistrationRoutesOptions {
  registerOwner: Pick<RegisterOwnerService, "execute">;
  secureCookies: boolean;
}

const registrationBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["email", "locale", "name", "password", "slug"],
  properties: {
    email: { type: "string", maxLength: 320 },
    locale: { type: "string", enum: ["es", "en"] },
    name: { type: "string", maxLength: 120 },
    password: { type: "string", maxLength: 128 },
    slug: { type: "string", maxLength: 63 },
  },
} as const;

const successResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["email", "tenantId", "userId"],
  properties: {
    email: { type: "string" },
    tenantId: { type: "string", format: "uuid" },
    userId: { type: "string", format: "uuid" },
  },
} as const;

export const registerRegistrationRoutes: FastifyPluginAsync<
  RegistrationRoutesOptions
> = async (app, options) => {
  await app.register(cookie);

  app.post<{ Body: RegisterOwnerCommand }>(
    "/auth/register",
    {
      schema: {
        body: registrationBodySchema,
        response: { 201: successResponseSchema },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const result = await options.registerOwner.execute(request.body);
        reply.setCookie("calenolav_session", result.sessionToken, {
          expires: result.expiresAt,
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secure: options.secureCookies,
        });
        return reply.code(201).send({
          email: result.email,
          tenantId: result.tenantId,
          userId: result.userId,
        });
      } catch (error) {
        if (error instanceof RegistrationValidationError) {
          return reply.code(400).send({
            error: { code: "invalid_registration", field: error.field },
          });
        }
        if (error instanceof RegistrationConflictError) {
          return reply.code(409).send({
            error: { code: "registration_conflict" },
          });
        }
        throw error;
      }
    },
  );
};
