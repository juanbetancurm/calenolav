# Booking safety decisions

## Public request boundary

A visitor chooses one canonical UTC start instant; the tenant policy remains the authority for slot duration. The request normalizes the public tenant slug and attendee email, trims the attendee name, requires a UUIDv4 idempotency key, and accepts only millisecond-explicit `Z` timestamps on the five-minute grid. Invalid input fails before database or Google access.

The idempotency key is scoped by tenant. Retrying one request cannot create another row for that tenant, while independent tenants may safely use the same client-generated key.

## Reservation ledger

PostgreSQL stores the minimum data needed to coordinate event creation: tenant, idempotency key, attendee identity, UTC interval, lifecycle status, and an optional Google event identifier. Pending and failed rows cannot contain an event identifier; a confirmed row must contain one.

The `btree_gist` exclusion constraint combines tenant equality with a half-open timestamp range. Pending and confirmed bookings cannot overlap for one tenant, touching boundaries remain valid, and failed attempts release the interval. This database decision closes the race between concurrent requests that cannot be closed reliably with an application read followed by an insert.

Bookings cascade with tenant deletion. Immediately before reservation, the application reloads current policy and connection state, recovers the refresh token only in tenant context, and recalculates the requested slot against a fresh opaque FreeBusy response. PostgreSQL remains the final local concurrency authority.

## Provider event boundary

Google receives one minimal event containing a generic summary, the attendee email, and the confirmed UTC interval. The provider event identifier is deterministically derived from the booking UUID, allowing uncertain retries and later reconciliation to converge on the same external event without storing an access token.

If event creation fails, the new pending row becomes failed and releases its interval. If Google accepts the event but the confirmation update fails, the row deliberately remains pending: releasing it could allow a second booking over an event that already exists. A later recovery process can reconcile that deterministic event safely.

Recovery atomically leases only stale pending rows that still have a tenant connection. A data-modifying PostgreSQL CTE combines FOR UPDATE SKIP LOCKED with an updated_at lease, preventing concurrent workers from receiving the same booking and making abandoned work eligible later. Each claimed row is isolated: credential, provider, or confirmation failure leaves it pending while the batch continues.

Repeating the deterministic Google insertion either creates the event or receives a duplicate-event 409; both outcomes converge on the same provider event identifier before the local row is confirmed. The recovery service returns counts only and never surfaces attendee identity, encrypted values, tokens, or provider errors.

The API starts recovery only when complete Google configuration is present. Its bounded runner executes immediately and at a validated interval, allows one batch at a time, clears its timer on shutdown, and waits for active work before the PostgreSQL pool closes. Successful logs contain aggregate counts only; failures use one stable component message without serializing the underlying error.

## Public HTTP boundary

Visitors create bookings with `POST /public/:slug/bookings` and do not need a session. Strict path and body schemas run before the application service. Successful responses contain only the booking ID, confirmed state, and UTC interval; validation, missing destinations, conflicts, and dependency failures use stable privacy-safe status codes with no-store and no-referrer headers.
