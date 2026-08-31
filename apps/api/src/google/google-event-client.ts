import { OAuth2Client } from "google-auth-library";

interface GoogleEventResponse {
  id?: string | null;
}

interface GoogleEventSdkClient {
  request(input: {
    data: {
      attendees: Array<{ email: string }>;
      end: { dateTime: string; timeZone: "UTC" };
      id: string;
      start: { dateTime: string; timeZone: "UTC" };
      summary: "Scheduled appointment";
    };
    method: "POST";
    params: { sendUpdates: "all" };
    url: string;
  }): Promise<{ data: GoogleEventResponse }>;
}

interface GoogleEventClientOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

type GoogleEventClientFactory = (
  options: GoogleEventClientOptions,
) => GoogleEventSdkClient;

export interface GoogleCalendarEventClientDependencies {
  clientFactory?: GoogleEventClientFactory;
  clientId: string;
  clientSecret: string;
}

export class GoogleCalendarEventError extends Error {
  override readonly name = "GoogleCalendarEventError";
  constructor() {
    super("Google Calendar event could not be created.");
  }
}

const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function requireConfiguration(value: string, message: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(message);
  return normalized;
}

function isDuplicateEventError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === 409) return true;
  if (
    !("response" in error) ||
    typeof error.response !== "object" ||
    error.response === null
  ) {
    return false;
  }
  return "status" in error.response && error.response.status === 409;
}

function createOfficialClient(options: GoogleEventClientOptions): GoogleEventSdkClient {
  const client = new OAuth2Client({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
  });
  client.setCredentials({ refresh_token: options.refreshToken });
  return { request: (input) => client.request<GoogleEventResponse>(input) };
}

export class GoogleCalendarEventClient {
  private readonly clientFactory: GoogleEventClientFactory;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(dependencies: GoogleCalendarEventClientDependencies) {
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

  async createEvent(input: {
    attendeeEmail: string;
    bookingId: string;
    calendarId: string;
    endAt: Date;
    refreshToken: string;
    startAt: Date;
  }): Promise<{ googleEventId: string }> {
    const attendeeEmail = input.attendeeEmail.trim().toLowerCase();
    const bookingId = input.bookingId.trim().toLowerCase();
    const calendarId = input.calendarId.trim();
    const refreshToken = input.refreshToken.trim();
    const startAt = input.startAt.getTime();
    const endAt = input.endAt.getTime();
    if (
      attendeeEmail.length === 0 ||
      !uuidV4Pattern.test(bookingId) ||
      calendarId.length === 0 ||
      refreshToken.length === 0 ||
      !Number.isFinite(startAt) ||
      !Number.isFinite(endAt) ||
      endAt <= startAt
    ) {
      throw new GoogleCalendarEventError();
    }

    const deterministicEventId = bookingId.replaceAll("-", "");
    try {
      const client = this.clientFactory({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        refreshToken,
      });
      const response = await client.request({
        data: {
          attendees: [{ email: attendeeEmail }],
          end: { dateTime: input.endAt.toISOString(), timeZone: "UTC" },
          id: deterministicEventId,
          start: { dateTime: input.startAt.toISOString(), timeZone: "UTC" },
          summary: "Scheduled appointment",
        },
        method: "POST",
        params: { sendUpdates: "all" },
        url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      });
      const googleEventId = response.data.id?.trim();
      if (!googleEventId) throw new GoogleCalendarEventError();
      return { googleEventId };
    } catch (error) {
      if (isDuplicateEventError(error)) {
        return { googleEventId: deterministicEventId };
      }
      throw new GoogleCalendarEventError();
    }
  }
}
