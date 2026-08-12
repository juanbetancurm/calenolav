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
| 4 | Owner registration, secure sessions, and tenant isolation | Next |
| 5 | Google OAuth connection and encrypted token storage | Planned |
| 6 | Availability rules and privacy-safe public availability API | Planned |
| 7 | Conflict-safe booking and Google event creation | Planned |
| 8 | React owner and visitor experiences | Planned |
| 9 | Sync jobs, webhooks, observability, and failure recovery | Planned |
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
