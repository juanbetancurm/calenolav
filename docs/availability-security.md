# Availability and privacy decisions

## Weekly policy

Each tenant owns at most one availability policy. It records an IANA time zone, a slot duration from 5 to 480 minutes, minimum notice from zero to 30 days, and a public booking horizon from 1 to 365 days. Values that represent minutes use a five-minute grid.

Weekly windows use ISO weekdays `1` through `7` and local minutes from the start of the day. A window must fit at least one configured slot. Adjacent windows are valid, while duplicates and overlaps are rejected after canonical sorting. An empty window list explicitly means that the tenant publishes no availability.

## Persistence boundary

PostgreSQL stores policy inputs rather than derived future slots. A policy belongs to one real tenant, and its weekly windows belong to that policy; tenant deletion cascades through both levels. Database checks enforce numeric limits, positive windows, grid alignment, and exact-row uniqueness. Cross-row overlap and IANA semantics remain application validations because they depend on the complete policy rather than one row.

Policy reads and complete replacements require an authenticated owner membership for the exact tenant before repository access. Replacement upserts the settings, deletes prior windows, and inserts the canonical new windows in one transaction. Any late database failure rolls back every part of the replacement and preserves the previously committed policy.

The owner HTTP boundary rejects malformed tenant identifiers and unexpected policy or window properties before authentication. Successful and expected-error responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; the API returns policy inputs only and never exposes membership, session, OAuth, or Google event data.

## Public privacy boundary

Candidate slots are calculated on demand and never materialized in PostgreSQL. Minimum notice advances by elapsed minutes, while the booking horizon advances by tenant-local calendar days. Slot duration is elapsed time: nonexistent wall times disappear during spring-forward, and both occurrences of repeated wall times become distinct UTC candidates during fall-back.

Busy input is limited to opaque start/end ranges. True overlap removes a candidate, while intervals that only touch a slot boundary do not. Event titles, attendees, descriptions, calendar identifiers, and raw provider responses never enter the calculator or public contract.

The public source query requires a tenant to have both a policy and a Google connection with the FreeBusy scope. Its encrypted refresh token is opened only with tenant-specific authenticated context and is passed to a fresh Google SDK client for one request, preventing mutable credentials from being shared across concurrent tenants. Empty weekly schedules return without decryption or provider access.

`GET /public/:slug/availability` exposes only resulting bookable UTC timestamps inside the configured notice and horizon. Unknown or incompletely configured tenants share one `404`, dependency failures share one `503`, malformed slugs are rejected before application work, and every response disables caching and referrer disclosure.
