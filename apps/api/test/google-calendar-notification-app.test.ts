import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { ProcessGoogleCalendarNotificationService } from "../src/google/google-calendar-notification.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("Google Calendar notification app wiring", () => {
  it("registers the receipt route only when its dependency is supplied", async () => {
    const processNotification = vi.fn<
      ProcessGoogleCalendarNotificationService["execute"]
    >(async () => ({ outcome: "accepted" }));
    const app = buildApp({
      googleCalendarNotifications: {
        clock: () => new Date("2026-09-07T12:00:00.000Z"),
        processNotification: { execute: processNotification },
      },
      readinessCheck: async () => undefined,
    });
    apps.push(app);

    const response = await app.inject({
      headers: {
        "x-goog-channel-id": randomUUID(),
        "x-goog-channel-token": "abcdefghijklmnopqrstuvwxyzABCDEFGH012345678",
        "x-goog-message-number": "1",
        "x-goog-resource-id": "opaque-resource",
        "x-goog-resource-state": "sync",
      },
      method: "POST",
      url: "/google/calendar/notifications",
    });
    expect(response.statusCode).toBe(204);
  });

  it("does not expose the receipt route when dependencies are omitted", async () => {
    const app = buildApp({ readinessCheck: async () => undefined });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/google/calendar/notifications",
    });
    expect(response.statusCode).toBe(404);
  });
});
