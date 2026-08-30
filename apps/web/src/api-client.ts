export interface AvailabilitySlot {
  readonly endAt: string;
  readonly startAt: string;
}

export interface PublicAvailability {
  readonly slots: readonly AvailabilitySlot[];
}

export interface PublicBookingInput {
  readonly attendeeEmail: string;
  readonly attendeeName: string;
  readonly idempotencyKey: string;
  readonly startAt: string;
}

export interface PublicBooking {
  readonly bookingId: string;
  readonly endAt: string;
  readonly startAt: string;
  readonly status: "confirmed";
}

interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
}

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: unknown;
  };
}

const safeErrorCodePattern = /^[a-z][a-z0-9_]{0,63}$/;

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super("The request could not be completed.");
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    const baseUrl = options.baseUrl ?? "/";
    this.#baseUrl = baseUrl === "/" ? "" : baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
  }

  async getPublicAvailability(slug: string): Promise<PublicAvailability> {
    const envelope = await this.#request<{ data: PublicAvailability }>(
      `/public/${encodeURIComponent(slug)}/availability`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      },
    );
    return envelope.data;
  }

  async createPublicBooking(
    slug: string,
    input: PublicBookingInput,
  ): Promise<PublicBooking> {
    const envelope = await this.#request<{ data: PublicBooking }>(
      `/public/${encodeURIComponent(slug)}/bookings`,
      {
        body: JSON.stringify(input),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    return envelope.data;
  }

  async #request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, init);
    } catch {
      throw new ApiClientError("request_failed", 0);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiClientError("request_failed", response.status);
    }

    if (!response.ok) {
      const code = this.#readSafeErrorCode(body);
      throw new ApiClientError(code, response.status);
    }
    if (typeof body !== "object" || body === null || !("data" in body)) {
      throw new ApiClientError("request_failed", response.status);
    }
    return body as T;
  }

  #readSafeErrorCode(body: unknown): string {
    const candidate = (body as ErrorEnvelope | null)?.error?.code;
    return typeof candidate === "string" && safeErrorCodePattern.test(candidate)
      ? candidate
      : "request_failed";
  }
}
