import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  GoogleCalendarNotificationValidationError,
  type ProcessGoogleCalendarNotificationService,
} from "./google-calendar-notification.js";

interface GoogleCalendarNotificationRoutesOptions {
  clock: () => Date;
  processNotification: Pick<ProcessGoogleCalendarNotificationService, "execute">;
}

interface GoogleCalendarNotificationHeaders {
  "x-goog-channel-id": string;
  "x-goog-channel-token": string;
  "x-goog-message-number": string;
  "x-goog-resource-id": string;
  "x-goog-resource-state": string;
}

const notificationHeadersSchema = {
  type: "object",
  required: [
    "x-goog-channel-id",
    "x-goog-channel-token",
    "x-goog-message-number",
    "x-goog-resource-id",
    "x-goog-resource-state",
  ],
  properties: {
    "x-goog-channel-id": {
      type: "string",
      pattern:
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    },
    "x-goog-channel-token": {
      type: "string",
      pattern: "^[A-Za-z0-9_-]{43}$",
    },
    "x-goog-message-number": {
      type: "string",
      pattern: "^[1-9][0-9]*$",
      maxLength: 19,
    },
    "x-goog-resource-id": { type: "string", minLength: 1, maxLength: 1024 },
    "x-goog-resource-state": {
      type: "string",
      enum: ["sync", "exists", "not_exists"],
    },
  },
} as const;

const emptyBodySchema = { type: "null" } as const;

function protectResponse(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Referrer-Policy", "no-referrer");
}

export const registerGoogleCalendarNotificationRoutes: FastifyPluginAsync<
  GoogleCalendarNotificationRoutesOptions
> = async (app, options) => {
  app.post<{ Headers: GoogleCalendarNotificationHeaders }>(
    "/google/calendar/notifications",
    {
      schema: {
        body: emptyBodySchema,
        headers: notificationHeadersSchema,
      },
    },
    async (request, reply) => {
      protectResponse(reply);
      try {
        await options.processNotification.execute({
          channelId: request.headers["x-goog-channel-id"],
          channelToken: request.headers["x-goog-channel-token"],
          messageNumber: request.headers["x-goog-message-number"],
          receivedAt: options.clock(),
          resourceId: request.headers["x-goog-resource-id"],
          resourceState: request.headers["x-goog-resource-state"],
        });
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof GoogleCalendarNotificationValidationError) {
          return reply.code(400).send({ error: { code: "invalid_notification" } });
        }
        return reply
          .code(503)
          .send({ error: { code: "notification_unavailable" } });
      }
    },
  );
};
