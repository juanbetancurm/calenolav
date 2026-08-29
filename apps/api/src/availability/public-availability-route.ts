import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  PublicAvailabilityNotFoundError,
  PublicAvailabilityUnavailableError,
  type GetPublicAvailabilityService,
} from "./public-availability-service.js";

interface PublicAvailabilityRoutesOptions {
  getAvailability: Pick<GetPublicAvailabilityService, "execute">;
}

interface PublicAvailabilityParameters {
  slug: string;
}

const publicAvailabilityParametersSchema = {
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

function protectPublicResponse(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Referrer-Policy", "no-referrer");
}

export const registerPublicAvailabilityRoutes: FastifyPluginAsync<
  PublicAvailabilityRoutesOptions
> = async (app, options) => {
  app.get<{ Params: PublicAvailabilityParameters }>(
    "/public/:slug/availability",
    { schema: { params: publicAvailabilityParametersSchema } },
    async (request, reply) => {
      protectPublicResponse(reply);
      try {
        const result = await options.getAvailability.execute({
          slug: request.params.slug,
        });
        return reply.code(200).send({ data: result });
      } catch (error) {
        if (error instanceof PublicAvailabilityNotFoundError) {
          return reply
            .code(404)
            .send({ error: { code: "availability_not_found" } });
        }
        if (error instanceof PublicAvailabilityUnavailableError) {
          return reply
            .code(503)
            .send({ error: { code: "availability_unavailable" } });
        }
        throw error;
      }
    },
  );
};
