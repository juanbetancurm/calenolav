# Availability and privacy decisions

## Weekly policy

Each tenant owns at most one availability policy. It records an IANA time zone, a slot duration from 5 to 480 minutes, minimum notice from zero to 30 days, and a public booking horizon from 1 to 365 days. Values that represent minutes use a five-minute grid.

Weekly windows use ISO weekdays `1` through `7` and local minutes from the start of the day. A window must fit at least one configured slot. Adjacent windows are valid, while duplicates and overlaps are rejected after canonical sorting. An empty window list explicitly means that the tenant publishes no availability.

## Persistence boundary

PostgreSQL stores policy inputs rather than derived future slots. A policy belongs to one real tenant, and its weekly windows belong to that policy; tenant deletion cascades through both levels. Database checks enforce numeric limits, positive windows, grid alignment, and exact-row uniqueness. Cross-row overlap and IANA semantics remain application validations because they depend on the complete policy rather than one row.

## Public privacy boundary

The future public availability response will expose only bookable candidate timestamps inside the configured notice and horizon. Google Calendar busy intervals will be treated as opaque time ranges: event titles, attendees, descriptions, calendar identifiers, and raw provider responses must never enter the public contract.
