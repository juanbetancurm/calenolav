import { OAuth2Client } from "google-auth-library";
import type { BusyInterval } from "../availability/slot-calculator.js";

interface GoogleFreeBusyResponse {
  calendars?: Record<
    string,
    {
      busy?: Array<{ end?: string; start?: string }>;
      errors?: unknown[];
    }
  >;
}

interface GoogleFreeBusySdkClient {
  request(input: {
    data: {
      items: Array<{ id: string }>;
      timeMax: string;
      timeMin: string;
      timeZone: "UTC";
    };
    method: "POST";
    url: string;
  }): Promise<{ data: GoogleFreeBusyResponse }>;
}

interface GoogleFreeBusyClientOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

type GoogleFreeBusyClientFactory = (
  options: GoogleFreeBusyClientOptions,
) => GoogleFreeBusySdkClient;

export interface GoogleCalendarFreeBusyClientDependencies {
  clientFactory?: GoogleFreeBusyClientFactory;
  clientId: string;
  clientSecret: string;
}

export class GoogleCalendarFreeBusyError extends Error {
  override readonly name = "GoogleCalendarFreeBusyError";

  constructor() {
    super("Google Calendar availability could not be read.");
  }
}

function requireConfiguration(value: string, message: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(message);
  return normalized;
}

function createOfficialClient(
  options: GoogleFreeBusyClientOptions,
): GoogleFreeBusySdkClient {
  const client = new OAuth2Client({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
  });
  client.setCredentials({ refresh_token: options.refreshToken });
  return {
    request: (input) => client.request<GoogleFreeBusyResponse>(input),
  };
}

function readBusyInterval(input: {
  end?: string;
  start?: string;
}): BusyInterval {
  if (typeof input.start !== "string" || typeof input.end !== "string") {
    throw new GoogleCalendarFreeBusyError();
  }
  const startAt = new Date(input.start);
  const endAt = new Date(input.end);
  if (
    !Number.isFinite(startAt.getTime()) ||
    !Number.isFinite(endAt.getTime()) ||
    endAt.getTime() <= startAt.getTime()
  ) {
    throw new GoogleCalendarFreeBusyError();
  }
  return { endAt, startAt };
}

export class GoogleCalendarFreeBusyClient {
  private readonly clientFactory: GoogleFreeBusyClientFactory;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(dependencies: GoogleCalendarFreeBusyClientDependencies) {
    this.clientId = requireConfiguration(
      dependencies.clientId,
      "Google OAuth client ID is required.",
    );
    this.clientSecret = requireConfiguration(
      dependencies.clientSecret,
      "Google OAuth client secret is required.",
    );
    this.clientFactory = dependencies.clientFactory ?? createOfficialClient;
  }

  async queryBusyIntervals(input: {
    calendarId: string;
    endAt: Date;
    refreshToken: string;
    startAt: Date;
  }): Promise<BusyInterval[]> {
    const calendarId = input.calendarId.trim();
    const refreshToken = input.refreshToken.trim();
    const startAt = input.startAt.getTime();
    const endAt = input.endAt.getTime();
    if (
      calendarId.length === 0 ||
      refreshToken.length === 0 ||
      !Number.isFinite(startAt) ||
      !Number.isFinite(endAt) ||
      endAt <= startAt
    ) {
      throw new GoogleCalendarFreeBusyError();
    }

    try {
      const client = this.clientFactory({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        refreshToken,
      });
      const response = await client.request({
        data: {
          items: [{ id: calendarId }],
          timeMax: input.endAt.toISOString(),
          timeMin: input.startAt.toISOString(),
          timeZone: "UTC",
        },
        method: "POST",
        url: "https://www.googleapis.com/calendar/v3/freeBusy",
      });
      const calendar = response.data.calendars?.[calendarId];
      if (
        !calendar ||
        !Array.isArray(calendar.busy) ||
        (calendar.errors?.length ?? 0) > 0
      ) {
        throw new GoogleCalendarFreeBusyError();
      }
      return calendar.busy.map(readBusyInterval);
    } catch {
      throw new GoogleCalendarFreeBusyError();
    }
  }
}
