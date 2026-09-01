# Google Calendar webhook safety decisions

## Opaque notification boundary

Google Calendar push notifications contain no event body. calenolav accepts only the channel identifier, channel token, resource identifier, resource state, message number, and receipt time needed to authenticate and order a notification. Event titles, attendees, descriptions, access tokens, and calendar payloads have no representation in this boundary.

Channel tokens are random server values. PostgreSQL stores only their SHA-256 digests, and notification processing compares the presented token through that digest. Channel identifiers are UUIDv4 values, resource identifiers remain opaque, and message numbers are canonical positive PostgreSQL bigint values.

## Replay and lifecycle safety

One atomic PostgreSQL update authenticates the channel and resource, requires an unexpired channel, and advances only a message number greater than the last accepted value. Duplicate, reordered, mismatched, unknown, and expired notifications produce the same ignored application outcome without exposing which check failed.

Watch channels belong to one encrypted Google Calendar connection and cascade when that connection is removed. The registry stores expiration and aggregate delivery state only. Channel registration, renewal overlap, and public HTTP receipt are separate follow-up boundaries so provider calls cannot weaken the reviewed persistence contract.

The design follows Google's Calendar push-notification protocol: tokens are echoed in `X-Goog-Channel-Token`, resource identifiers are opaque, `sync` can arrive before the watch response, message numbers increase without being sequential, and notification requests contain no resource body.

The public `POST /google/calendar/notifications` route is registered only with complete Google runtime configuration. Strict schemas require the five opaque Google headers and reject every body before application access. Accepted and ignored messages both return an empty 204 response with no-store and no-referrer headers, preventing the endpoint from becoming a channel, token, resource, expiration, or replay oracle.
