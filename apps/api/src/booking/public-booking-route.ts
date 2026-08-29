import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  BookingConflictError,
  BookingNotFoundError,
  BookingUnavailableError,
  type CreateBookingService,
} from "./create-booking-service.js";
import {
  BookingRequestValidationError,
  type PublicBookingRequest,
} from "./booking-request.js";

interface PublicBookingRoutesOptions {
  createBooking: Pick<CreateBookingService, "execute">;
}

interface PublicBookingParameters {
  slug: string;
}

type PublicBookingBody = Omit<PublicBookingRequest, "tenantSlug">;

const publicBookingParametersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["slug"],
  properties: {
    slug: {
      type: "string",
      minLength: 1,
      maxLength: 63,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
  },
} as const;

const publicBookingBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["attendeeEmail", "attendeeName", "idempotencyKey", "startAt"],
  properties: {
    attendeeEmail: { type: "string", minLength: 1, maxLength: 320 },
    attendeeName: { type: "string", minLength: 1, maxLength: 120 },
    idempotencyKey: {
      type: "string",
      pattern:
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    },
    startAt: { type: "string", minLength: 24, maxLength: 30 },
  },
} as const;

const publicBookingPropertyNames = new Set([
  "attendeeEmail",
  "attendeeName",
  "idempotencyKey",
  "startAt",
]);

function hasUnexpectedBookingProperties(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some(
      (property) => !publicBookingPropertyNames.has(property),
    )
  );
}

function protectPublicResponse(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Referrer-Policy", "no-referrer");
}

export const registerPublicBookingRoutes: FastifyPluginAsync<
  PublicBookingRoutesOptions
> = async (app, options) => {
  app.post<{ Body: PublicBookingBody; Params: PublicBookingParameters }>(
    "/public/:slug/bookings",
    {
      onRequest: async (_request, reply) => protectPublicResponse(reply),
      preValidation: async (request, reply) => {
        if (hasUnexpectedBookingProperties(request.body)) {
          return reply
            .code(400)
            .send({ error: { code: "invalid_booking_request" } });
        }
      },
      schema: {
        body: publicBookingBodySchema,
        params: publicBookingParametersSchema,
      },
    },
    async (request, reply) => {
      try {
        const result = await options.createBooking.execute({
          ...request.body,
          tenantSlug: request.params.slug,
        });
        return reply.code(201).send({ data: result });
      } catch (error) {
        if (error instanceof BookingRequestValidationError) {
          return reply
            .code(400)
            .send({ error: { code: "invalid_booking_request" } });
        }
        if (error instanceof BookingNotFoundError) {
          return reply.code(404).send({ error: { code: "booking_not_found" } });
        }
        if (error instanceof BookingConflictError) {
          return reply.code(409).send({ error: { code: "booking_conflict" } });
        }
        if (error instanceof BookingUnavailableError) {
          return reply
            .code(503)
            .send({ error: { code: "booking_unavailable" } });
        }
        throw error;
      }
    },
  );
};
