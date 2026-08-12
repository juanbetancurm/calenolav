import Fastify, { type FastifyInstance } from "fastify";
import type { ReadinessCheck } from "./readiness.js";

export type { ReadinessCheck } from "./readiness.js";

export interface BuildAppOptions {
  logger?: boolean;
  readinessCheck: ReadinessCheck;
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
