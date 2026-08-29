# Booking safety decisions

## Public request boundary

A visitor chooses one canonical UTC start instant; the tenant policy remains the authority for slot duration. The request normalizes the public tenant slug and attendee email, trims the attendee name, requires a UUIDv4 idempotency key, and accepts only millisecond-explicit `Z` timestamps on the five-minute grid. Invalid input fails before database or Google access.

The idempotency key is scoped by tenant. Retrying one request cannot create another row for that tenant, while independent tenants may safely use the same client-generated key.

## Reservation ledger

PostgreSQL stores the minimum data needed to coordinate event creation: tenant, idempotency key, attendee identity, UTC interval, lifecycle status, and an optional Google event identifier. Pending and failed rows cannot contain an event identifier; a confirmed row must contain one.

The `btree_gist` exclusion constraint combines tenant equality with a half-open timestamp range. Pending and confirmed bookings cannot overlap for one tenant, touching boundaries remain valid, and failed attempts release the interval. This database decision closes the race between concurrent requests that cannot be closed reliably with an application read followed by an insert.

Bookings cascade with tenant deletion. The application will still revalidate current policy and Google FreeBusy before attempting a reservation, but PostgreSQL remains the final local concurrency authority.
