import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GoogleCalendarNotificationValidationError,
  ProcessGoogleCalendarNotificationService,
} from "../src/google/google-calendar-notification.js";

const channelId = randomUUID();
const channelToken = "abcdefghijklmnopqrstuvwxyzABCDEFGH012345678";
const receivedAt = new Date("2026-09-07T12:00:00.000Z");

describe("Google Calendar notification processing", () => {
  it("hashes the channel token and records only canonical opaque metadata", async () => {
    const recordNotification = vi.fn(async () => true);
    const service = new ProcessGoogleCalendarNotificationService({
      repository: { recordNotification },
    });

    await expect(
      service.execute({
        channelId,
        channelToken,
        messageNumber: "42",
        receivedAt,
        resourceId: "opaque-google-resource",
        resourceState: "exists",
      }),
    ).resolves.toEqual({ outcome: "accepted" });
    expect(recordNotification).toHaveBeenCalledWith({
      channelId,
      channelTokenHash: createHash("sha256").update(channelToken).digest("hex"),
      messageNumber: "42",
      receivedAt,
      resourceId: "opaque-google-resource",
      resourceState: "exists",
    });
  });

  it("quietly ignores unknown, expired, mismatched, or replayed notifications", async () => {
    const service = new ProcessGoogleCalendarNotificationService({
      repository: { recordNotification: vi.fn(async () => false) },
    });

    await expect(
      service.execute({
        channelId,
        channelToken,
        messageNumber: "43",
        receivedAt,
        resourceId: "opaque-google-resource",
        resourceState: "not_exists",
      }),
    ).resolves.toEqual({ outcome: "ignored" });
  });

  it.each([
    { channelId: "not-a-uuid" },
    { channelToken: "short" },
    { messageNumber: "0" },
    { messageNumber: "1.5" },
    { resourceId: "" },
    { resourceState: "deleted" },
    { receivedAt: new Date("invalid") },
  ])("rejects malformed opaque metadata with one safe error", async (override) => {
    const recordNotification = vi.fn(async () => true);
    const service = new ProcessGoogleCalendarNotificationService({
      repository: { recordNotification },
    });

    await expect(
      service.execute({
        channelId,
        channelToken,
        messageNumber: "42",
        receivedAt,
        resourceId: "opaque-google-resource",
        resourceState: "sync",
        ...override,
      }),
    ).rejects.toBeInstanceOf(GoogleCalendarNotificationValidationError);
    expect(recordNotification).not.toHaveBeenCalled();
  });
});
