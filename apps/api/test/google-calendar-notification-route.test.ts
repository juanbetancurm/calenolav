import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GoogleCalendarNotificationValidationError,
  type ProcessGoogleCalendarNotificationService,
} from "../src/google/google-calendar-notification.js";
import { registerGoogleCalendarNotificationRoutes } from "../src/google/google-calendar-notification-route.js";

const apps: ReturnType<typeof Fastify>[] = [];
const validHeaders = {
  "x-goog-channel-id": randomUUID(),
  "x-goog-channel-token": "abcdefghijklmnopqrstuvwxyzABCDEFGH012345678",
  "x-goog-message-number": "42",
  "x-goog-resource-id": "opaque-google-resource",
  "x-goog-resource-state": "exists",
};

function createApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  const processNotification = vi.fn<
    ProcessGoogleCalendarNotificationService["execute"]
  >(async () => ({ outcome: "accepted" }));
  const clock = vi.fn(() => new Date("2026-09-07T12:00:00.000Z"));
  void app.register(registerGoogleCalendarNotificationRoutes, {
    clock,
    processNotification: { execute: processNotification },
  });
  return { app, clock, processNotification };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("POST /google/calendar/notifications", () => {
  it.each(["accepted", "ignored"] as const)(
    "acknowledges %s notifications without an oracle or response body",
    async (outcome) => {
      const { app, processNotification } = createApp();
      processNotification.mockResolvedValueOnce({ outcome });

      const response = await app.inject({
        headers: validHeaders,
        method: "POST",
        url: "/google/calendar/notifications",
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(processNotification).toHaveBeenCalledWith({
        channelId: validHeaders["x-goog-channel-id"],
        channelToken: validHeaders["x-goog-channel-token"],
        messageNumber: "42",
        receivedAt: new Date("2026-09-07T12:00:00.000Z"),
        resourceId: "opaque-google-resource",
        resourceState: "exists",
      });
    },
  );

  it("rejects malformed headers and any body before application access", async () => {
    const { app, processNotification } = createApp();
    const malformed = await app.inject({
      headers: { ...validHeaders, "x-goog-message-number": "0" },
      method: "POST",
      url: "/google/calendar/notifications",
    });
    const body = await app.inject({
      headers: validHeaders,
      method: "POST",
      payload: { event: "private" },
      url: "/google/calendar/notifications",
    });

    expect([malformed.statusCode, body.statusCode]).toEqual([400, 400]);
    expect(processNotification).not.toHaveBeenCalled();
  });

  it.each([
    [400, new GoogleCalendarNotificationValidationError(), "invalid_notification"],
    [503, new Error("provider token leaked"), "notification_unavailable"],
  ] as const)("maps application failure to safe %i", async (status, error, code) => {
    const { app, processNotification } = createApp();
    processNotification.mockRejectedValueOnce(error);

    const response = await app.inject({
      headers: validHeaders,
      method: "POST",
      url: "/google/calendar/notifications",
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: { code } });
    expect(response.body).not.toContain(error.message);
  });
});
