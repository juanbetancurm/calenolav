import { createHash } from "node:crypto";

export type GoogleCalendarResourceState = "exists" | "not_exists" | "sync";

export interface GoogleCalendarNotificationRecord {
  channelId: string;
  channelTokenHash: string;
  messageNumber: string;
  receivedAt: Date;
  resourceId: string;
  resourceState: GoogleCalendarResourceState;
}

interface GoogleCalendarNotificationRepository {
  recordNotification(input: GoogleCalendarNotificationRecord): Promise<boolean>;
}

interface ProcessGoogleCalendarNotificationDependencies {
  repository: GoogleCalendarNotificationRepository;
}

export class GoogleCalendarNotificationValidationError extends Error {
  override readonly name = "GoogleCalendarNotificationValidationError";
  constructor() {
    super("Google Calendar notification is invalid.");
  }
}

const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const channelTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const positiveIntegerPattern = /^[1-9][0-9]*$/u;
const maximumMessageNumber = 9_223_372_036_854_775_807n;
const resourceStates = new Set<GoogleCalendarResourceState>([
  "exists",
  "not_exists",
  "sync",
]);

export class ProcessGoogleCalendarNotificationService {
  constructor(
    private readonly dependencies: ProcessGoogleCalendarNotificationDependencies,
  ) {}

  async execute(input: {
    channelId: string;
    channelToken: string;
    messageNumber: string;
    receivedAt: Date;
    resourceId: string;
    resourceState: string;
  }): Promise<{ outcome: "accepted" | "ignored" }> {
    const channelId = input.channelId.trim().toLowerCase();
    const channelToken = input.channelToken.trim();
    const messageNumber = input.messageNumber.trim();
    const resourceId = input.resourceId.trim();
    const resourceState = input.resourceState.trim().toLowerCase();
    const receivedAtMs = input.receivedAt.getTime();

    let parsedMessageNumber: bigint;
    try {
      parsedMessageNumber = BigInt(messageNumber);
    } catch {
      throw new GoogleCalendarNotificationValidationError();
    }

    if (
      !uuidV4Pattern.test(channelId) ||
      !channelTokenPattern.test(channelToken) ||
      !positiveIntegerPattern.test(messageNumber) ||
      parsedMessageNumber > maximumMessageNumber ||
      resourceId.length === 0 ||
      resourceId.length > 1_024 ||
      /[\u0000-\u001f\u007f]/u.test(resourceId) ||
      !resourceStates.has(resourceState as GoogleCalendarResourceState) ||
      !Number.isFinite(receivedAtMs)
    ) {
      throw new GoogleCalendarNotificationValidationError();
    }

    const accepted = await this.dependencies.repository.recordNotification({
      channelId,
      channelTokenHash: createHash("sha256")
        .update(channelToken, "utf8")
        .digest("hex"),
      messageNumber,
      receivedAt: input.receivedAt,
      resourceId,
      resourceState: resourceState as GoogleCalendarResourceState,
    });
    return { outcome: accepted ? "accepted" : "ignored" };
  }
}
