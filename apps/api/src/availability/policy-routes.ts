import cookie from "@fastify/cookie";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { SESSION_COOKIE_NAME } from "../auth/session-routes.js";
import {
  AuthorizationError,
  InvalidSessionError,
  type AuthenticateSessionService,
} from "../auth/session-services.js";
import type {
  GetTenantAvailabilityPolicyService,
  ReplaceTenantAvailabilityPolicyService,
} from "./policy-services.js";
import {
  AvailabilityPolicyValidationError,
  type AvailabilityPolicy,
} from "./weekly-policy.js";

interface AvailabilityPolicyRoutesOptions {
  authenticateSession: Pick<AuthenticateSessionService, "execute">;
  getPolicy: Pick<GetTenantAvailabilityPolicyService, "execute">;
  replacePolicy: Pick<ReplaceTenantAvailabilityPolicyService, "execute">;
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

const weeklyWindowSchema = {
  type: "object",
  additionalProperties: false,
  required: ["endMinute", "startMinute", "weekday"],
  properties: {
    endMinute: { type: "integer", minimum: 1, maximum: 1440, multipleOf: 5 },
    startMinute: { type: "integer", minimum: 0, maximum: 1439, multipleOf: 5 },
    weekday: { type: "integer", minimum: 1, maximum: 7 },
  },
} as const;

const availabilityPolicySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "bookingWindowDays",
    "minimumNoticeMinutes",
    "slotDurationMinutes",
    "timeZone",
    "windows",
  ],
  properties: {
    bookingWindowDays: { type: "integer", minimum: 1, maximum: 365 },
    minimumNoticeMinutes: {
      type: "integer",
      minimum: 0,
      maximum: 43_200,
      multipleOf: 5,
    },
    slotDurationMinutes: {
      type: "integer",
      minimum: 5,
      maximum: 480,
      multipleOf: 5,
    },
    timeZone: { type: "string", minLength: 1, maxLength: 100 },
    windows: { type: "array", items: weeklyWindowSchema },
  },
} as const;

const policyPropertyNames = new Set([
  "bookingWindowDays",
  "minimumNoticeMinutes",
  "slotDurationMinutes",
  "timeZone",
  "windows",
]);
const windowPropertyNames = new Set(["endMinute", "startMinute", "weekday"]);

function hasUnexpectedProperties(
  value: unknown,
  allowedProperties: ReadonlySet<string>,
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some((property) => !allowedProperties.has(property))
  );
}

function hasUnexpectedPolicyProperties(value: unknown): boolean {
  if (hasUnexpectedProperties(value, policyPropertyNames)) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const windows = (value as Record<string, unknown>).windows;
  return (
    Array.isArray(windows) &&
    windows.some((window) =>
      hasUnexpectedProperties(window, windowPropertyNames),
    )
  );
}

function protectPolicyResponse(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Referrer-Policy", "no-referrer");
}

function sendExpectedError(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidSessionError) {
    return reply.code(401).send({ error: { code: "invalid_session" } });
  }
  if (error instanceof AuthorizationError) {
    return reply.code(403).send({ error: { code: "forbidden" } });
  }
  if (error instanceof AvailabilityPolicyValidationError) {
    return reply
      .code(400)
      .send({ error: { code: "invalid_availability_policy" } });
  }
  throw error;
}

export const registerAvailabilityPolicyRoutes: FastifyPluginAsync<
  AvailabilityPolicyRoutesOptions
> = async (app, options) => {
  await app.register(cookie);

  app.get<{ Params: TenantParameters }>(
    "/tenants/:tenantId/availability-policy",
    { schema: { params: tenantParametersSchema } },
    async (request, reply) => {
      protectPolicyResponse(reply);
      const rawToken = request.cookies[SESSION_COOKIE_NAME];
      if (!rawToken) {
        return reply.code(401).send({ error: { code: "invalid_session" } });
      }

      try {
        const principal = await options.authenticateSession.execute(rawToken);
        const result = await options.getPolicy.execute({
          principal,
          tenantId: request.params.tenantId,
        });
        return reply.code(200).send({ data: result });
      } catch (error) {
        return sendExpectedError(error, reply);
      }
    },
  );

  app.put<{ Body: AvailabilityPolicy; Params: TenantParameters }>(
    "/tenants/:tenantId/availability-policy",
    {
      schema: {
        body: availabilityPolicySchema,
        params: tenantParametersSchema,
      },
      preValidation: async (request, reply) => {
        if (hasUnexpectedPolicyProperties(request.body)) {
          protectPolicyResponse(reply);
          return reply
            .code(400)
            .send({ error: { code: "invalid_availability_policy" } });
        }
      },
    },
    async (request, reply) => {
      protectPolicyResponse(reply);
      const rawToken = request.cookies[SESSION_COOKIE_NAME];
      if (!rawToken) {
        return reply.code(401).send({ error: { code: "invalid_session" } });
      }

      try {
        const principal = await options.authenticateSession.execute(rawToken);
        const result = await options.replacePolicy.execute({
          policy: request.body,
          principal,
          tenantId: request.params.tenantId,
        });
        return reply.code(200).send({ data: result });
      } catch (error) {
        return sendExpectedError(error, reply);
      }
    },
  );
};