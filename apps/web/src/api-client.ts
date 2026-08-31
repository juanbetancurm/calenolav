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

export interface OwnerMembership {
  readonly role: "member" | "owner";
  readonly tenantId: string;
}

export interface OwnerSession {
  readonly email: string;
  readonly memberships: readonly OwnerMembership[];
  readonly userId: string;
}

export interface SignInInput {
  readonly email: string;
  readonly password: string;
}

export interface SignInResult {
  readonly email: string;
  readonly userId: string;
}

export interface AvailabilityWindow {
  readonly endMinute: number;
  readonly startMinute: number;
  readonly weekday: number;
}

export interface AvailabilityPolicy {
  readonly bookingWindowDays: number;
  readonly minimumNoticeMinutes: number;
  readonly slotDurationMinutes: number;
  readonly timeZone: string;
  readonly windows: readonly AvailabilityWindow[];
}

export interface AvailabilityPolicyResult {
  readonly policy: AvailabilityPolicy | null;
  readonly tenantId: string;
}

export type GoogleConnectionStatus =
  | { readonly connected: false; readonly tenantId: string }
  | {
      readonly calendarId: string;
      readonly connected: true;
      readonly connectedAt: string;
      readonly googleAccountEmail: string;
      readonly grantedScopes: readonly string[];
      readonly tenantId: string;
      readonly updatedAt: string;
    };

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

  async getSession(): Promise<OwnerSession> {
    return this.#requestDocument<OwnerSession>("/auth/session", {
      credentials: "include",
      headers: { Accept: "application/json" },
      method: "GET",
    });
  }

  async signIn(input: SignInInput): Promise<SignInResult> {
    return this.#requestDocument<SignInResult>("/auth/sign-in", {
      body: JSON.stringify(input),
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  }

  async signOut(): Promise<void> {
    const response = await this.#send("/auth/sign-out", {
      credentials: "include",
      headers: { Accept: "application/json" },
      method: "POST",
    });
    if (response.ok) return;
    throw await this.#responseError(response);
  }

  async getGoogleConnectionStatus(tenantId: string): Promise<GoogleConnectionStatus> {
    const envelope = await this.#request<{ data: GoogleConnectionStatus }>(
      `/tenants/${encodeURIComponent(tenantId)}/google/connection`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      },
    );
    return envelope.data;
  }

  getGoogleAuthorizationUrl(tenantId: string): string {
    return `${this.#baseUrl}/tenants/${encodeURIComponent(tenantId)}/google/oauth/start`;
  }

  async disconnectGoogleCalendar(tenantId: string): Promise<void> {
    const response = await this.#send(
      `/tenants/${encodeURIComponent(tenantId)}/google/connection`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
    if (response.ok) return;
    throw await this.#responseError(response);
  }

  async getAvailabilityPolicy(tenantId: string): Promise<AvailabilityPolicyResult> {
    const envelope = await this.#request<{ data: AvailabilityPolicyResult }>(
      `/tenants/${encodeURIComponent(tenantId)}/availability-policy`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      },
    );
    return envelope.data;
  }

  async replaceAvailabilityPolicy(
    tenantId: string,
    policy: AvailabilityPolicy,
  ): Promise<AvailabilityPolicyResult> {
    const envelope = await this.#request<{ data: AvailabilityPolicyResult }>(
      `/tenants/${encodeURIComponent(tenantId)}/availability-policy`,
      {
        body: JSON.stringify(policy),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PUT",
      },
    );
    return envelope.data;
  }

  async #request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.#send(path, init);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiClientError("request_failed", response.status);
    }

    if (!response.ok) throw this.#errorFromBody(body, response.status);
    if (typeof body !== "object" || body === null || !("data" in body)) {
      throw new ApiClientError("request_failed", response.status);
    }
    return body as T;
  }

  async #requestDocument<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.#send(path, init);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiClientError("request_failed", response.status);
    }

    if (!response.ok) throw this.#errorFromBody(body, response.status);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ApiClientError("request_failed", response.status);
    }
    return body as T;
  }

  async #send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(`${this.#baseUrl}${path}`, init);
    } catch {
      throw new ApiClientError("request_failed", 0);
    }
  }

  async #responseError(response: Response): Promise<ApiClientError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return new ApiClientError("request_failed", response.status);
    }
    return this.#errorFromBody(body, response.status);
  }

  #errorFromBody(body: unknown, status: number): ApiClientError {
    return new ApiClientError(this.#readSafeErrorCode(body), status);
  }

  #readSafeErrorCode(body: unknown): string {
    const candidate = (body as ErrorEnvelope | null)?.error?.code;
    return typeof candidate === "string" && safeErrorCodePattern.test(candidate)
      ? candidate
      : "request_failed";
  }
}
