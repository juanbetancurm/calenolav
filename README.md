# calenolav

calenolav is a secure, multi-tenant scheduling application. Calendar owners will connect Google Calendar, publish privacy-safe availability, and receive bookings created by the backend only after the slot has been revalidated.


## Chosen architecture

- **Frontend:** React, Vite, and TypeScript.
- **Backend:** Node.js, TypeScript, and Fastify.
- **Database:** PostgreSQL with Drizzle ORM and explicit migrations.
- **Integration:** Google OAuth and Google Calendar calls only from the backend.
- **Testing:** Vitest, Testing Library, API/database integration tests, Playwright, and Gherkin acceptance scenarios.
- **Runtime:** Docker Compose for local development; production containers will be added after the vertical slices run locally.

This modular-monolith design keeps one deployable backend while separating domain, application, persistence, Google integration, and HTTP concerns. It is easier to learn and operate than microservices, while preserving boundaries that can be split later if real scaling data justifies it.

## Guided implementation roadmap

| Step | Outcome | Status |
| --- | --- | --- |
| 1 | Repository conventions and a healthy PostgreSQL container | Complete |
| 2 | Tests-first initial relational schema and migrations | Complete |
| 3 | Typed backend skeleton with health/readiness endpoints | Complete |
| 4 | Owner registration, secure sessions, and tenant isolation | Complete |
| 5 | Google OAuth connection and encrypted token storage | Complete |
| 6 | Availability rules and privacy-safe public availability API | Complete |
| 7 | Conflict-safe booking and Google event creation | Complete |
| 8 | React owner and visitor experiences | Complete |
| 9 | Sync jobs, webhooks, observability, and failure recovery | In progress |
| 10 | End-to-end tests, production containers, CI, and deployment | Planned |

## Step 1: local database

PostgreSQL runs in a container so every contributor uses the same database major version and setup. The named Docker volume preserves local data when the container stops. The health check lets later services wait for the database to become ready instead of guessing with a sleep.

`.env.example` contains safe local defaults only. Real credentials and OAuth secrets must stay in the ignored `.env` file or a production secret manager.

## Step 2: identity and tenant foundation

The first schema slice contains users, tenants, tenant memberships, and hashed sessions. Keeping membership separate makes every future owner operation tenant-aware and gives us a clear authorization boundary.

Database integration tests specify the important constraints before the migration is accepted: email uniqueness ignores letter case, public slugs use a URL-safe format, memberships require real tenants and users, and an owner can be related to a tenant. Each test runs inside a transaction that is rolled back, so tests do not leave sample records behind.
## Step 3: backend health contracts

The Node backend starts with separate liveness and readiness contracts. Liveness reports whether the HTTP process can answer and must not depend on PostgreSQL. Readiness reports whether the process can safely receive traffic and returns a privacy-safe `503` response when a dependency check fails.

These contracts are written as Fastify injection tests before route implementation. Injection exercises the real HTTP routing and serialization stack without opening a network port, keeping the tests fast and deterministic.
## Step 4: owner registration and sessions

Registration is implemented as an application use case before adding its HTTP and PostgreSQL adapters. The use case validates and normalizes public identity data, delegates password hashing, creates one user + tenant + owner membership + session atomically, and returns the raw session token only to the caller. Only its hash is eligible for database storage.

While password authentication is the only factor, passwords require 15–128 Unicode code points. All printable characters and spaces are allowed, and no character-composition rule is imposed. This follows current NIST single-factor guidance while still permitting long passphrases.
The API now supports `POST /auth/register`, `POST /auth/sign-in`, `GET /auth/session`, and `POST /auth/sign-out`. Successful authentication stores the raw session token only in a hardened cookie; PostgreSQL stores its SHA-256 digest. Session lookup returns a tenant-aware principal, and authorization compares the requested tenant and required role against that principal.

Sign-in deliberately returns one generic failure for an unknown email or incorrect password and performs scrypt verification in both cases. Sign-out revokes server-side state, clears the browser cookie, and is safe to repeat.
## Step 5: Google Calendar connection

The OAuth boundary starts with two relational records. A short-lived authorization attempt stores only a digest of the CSRF state and an encrypted PKCE verifier. A completed tenant connection stores Google account identity, the scopes actually granted, the selected calendar, and an encrypted refresh-token envelope. Short-lived Google access tokens are not persisted.

Sensitive OAuth values use AES-256-GCM with a fresh IV and tenant-specific authenticated context. Environment configuration supplies a versioned key ring: the current key encrypts new values, while retained older versions allow safe decryption during key rotation. Keys never belong in PostgreSQL or Git.
An authenticated tenant owner can start authorization with `POST /tenants/:tenantId/google/oauth/start`. The backend creates a ten-minute encrypted attempt and returns a `303` redirect to Google with offline access, S256 PKCE, OpenID identity scopes, and the minimum free/busy plus owned-event Calendar scopes.

Google returns to the public `GET /google/oauth/callback` endpoint. The backend consumes state once, recovers PKCE, exchanges the code, verifies the signed identity for the configured client, requires every Calendar scope, and upserts only an encrypted refresh token. OAuth routes remain absent when complete configuration is omitted, and callback failures return one privacy-safe response.

Authenticated tenant owners can inspect safe connection metadata with `GET /tenants/:tenantId/google/connection` and disconnect with `DELETE /tenants/:tenantId/google/connection`. Disconnect atomically removes and returns the encrypted credential, then attempts to decrypt it in tenant context and revoke the Google grant. Local deletion remains successful and repeatable when OAuth is disabled, the credential cannot be opened, or Google rejects the revocation request.

## Step 6: availability rules

Availability starts with one tenant policy containing an IANA time zone, slot duration, minimum notice, and booking horizon. Separate weekly windows use ISO weekdays and five-minute local-time boundaries. The application canonicalizes and rejects overlapping windows before persistence, while PostgreSQL enforces tenant ownership, structural limits, uniqueness, and cascade cleanup.

Authenticated tenant owners can read and replace the complete policy with `GET /tenants/:tenantId/availability-policy` and `PUT /tenants/:tenantId/availability-policy`. Replacement updates the settings and all weekly windows in one transaction, so a late constraint failure preserves the prior policy. Responses disable caching and referrer disclosure, and malformed or unexpected input is rejected before session authentication.

Derived slots are deliberately not stored. A pure calculator expands persisted rules into fixed-duration UTC candidates, applies elapsed minimum notice, advances the horizon by tenant-local calendar days, handles daylight-saving gaps and repeated times, and subtracts only opaque busy intervals.

Visitors can read `GET /public/:slug/availability` without a session. The backend opens the tenant-scoped refresh token only in memory, gives each request a fresh credential-isolated Google client, asks FreeBusy for opaque ranges, and returns UTC slot timestamps only. Missing configuration is indistinguishable from an unknown public tenant, provider failures return a generic unavailable response, and empty schedules avoid credential recovery and Google entirely.

## Step 7: conflict-safe booking

Public booking input now has one canonical representation: normalized tenant and attendee identity, a UUIDv4 idempotency key, and an explicit UTC start on the five-minute grid. Slot duration remains server-owned through the tenant policy rather than visitor input.

The booking ledger uses tenant-scoped idempotency and a PostgreSQL `btree_gist` exclusion constraint over half-open UTC ranges. Pending and confirmed reservations cannot overlap for the same tenant even under concurrent requests; failed attempts release the interval and touching slot boundaries remain valid.

Before reserving, the backend reloads current policy and connection state and rechecks the requested slot against fresh opaque Google FreeBusy ranges. `POST /public/:slug/bookings` then atomically reserves the interval, creates one minimal Google event with an ID derived from the booking UUID, and confirms the row. Provider failure releases a new reservation, while a post-event database failure stays pending for safe reconciliation. Public responses expose only confirmed booking identity and UTC times.

## Step 8: React owner and visitor experiences

The frontend begins with one strict React, Vite, and TypeScript workspace. Its typed API client sends credentials through the browser transport without exposing session tokens, accepts only the public availability and booking response shapes, and maps malformed failures to one safe browser error.

The responsive application shell separates visitor scheduling from the owner workspace, rejects unsafe tenant paths locally, and uses semantic HTML without third-party fonts, images, analytics, or tracking requests. Visitors can load current slots, submit only their own booking fields with one retry-stable idempotency key, receive a privacy-safe confirmation, and refresh after a booking conflict.

Owners can restore a hardened session, sign in and out, and load privacy-safe Google connection and availability summaries for an exact owner membership. The HttpOnly token never enters React, non-owner accounts cannot trigger tenant reads, and dependency failures expose one retryable state. Owners can enter exact-tenant Google OAuth, disconnect locally, and replace the complete availability policy through responsive weekly-window controls that convert wall times to canonical minutes.

Development uses exact shared Vite, Vitest, and Rolldown versions. On Windows systems where Application Control blocks native Rolldown modules, the version-matched WASI fallback preserves the enforced policy while keeping tests and production builds deterministic.

## Step 9: recovery and synchronization

Failure recovery begins with an atomic lease over stale pending bookings. Concurrent workers use PostgreSQL row locking and updated_at leases so only one worker receives a booking at a time, while failures remain pending for a later bounded retry. The worker-facing service decrypts one tenant credential in context, repeats the deterministic Google event insertion, and confirms only the local booking state.

Google 409 responses for the deterministic event identifier are treated as evidence that the same event already exists, allowing an uncertain earlier success to converge without creating a second event. Recovery results expose aggregate claimed, confirmed, and retryable counts only; attendee, credential, and provider details never enter operational output.
