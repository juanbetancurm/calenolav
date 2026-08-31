# Frontend security boundary

The React application is a public client, not a trusted execution boundary. It contains no Google credentials, encryption keys, database identifiers, or calendar-event metadata. All authentication, tenant authorization, slot revalidation, conflict handling, and Google operations remain in the API.

The browser client sends cookies with same-origin API requests so hardened owner sessions can work without exposing raw session tokens to application code. Public booking requests contain only attendee identity, a UUIDv4 idempotency key, and the selected UTC start. Duration, tenant identity, calendar identity, and event construction remain server-owned.

The owner workspace restores only the safe session principal and selects tenant resources exclusively from an owner membership returned by the API. Connection and policy summaries omit credentials and provider internals. Invalid sessions return to sign-in, non-owner accounts cannot trigger tenant reads, and dependency failures collapse to one retryable workspace state.

Owner mutations reuse only the tenant identifier selected from that owner membership. The browser builds the same-origin OAuth entry without reading provider configuration, treats disconnect as a local cookie-authenticated deletion, and refreshes safe connection status afterward. Availability saves replace the complete policy and canonical weekly-window collection; browser wall-time controls convert to minute offsets, while API validation and transactional persistence remain authoritative.

API failures are reduced to a stable status and safe error code. Malformed bodies, network failures, and unexpected provider responses never become browser-visible internal detail. Public pages display UTC-derived availability and confirmed booking state only.

The visitor flow generates one idempotency key when a slot is selected and keeps it stable across a safe retry. A conflict discards that selection and reloads current availability instead of repeating an uncertain provider side effect. Confirmation omits attendee identity and displays only the confirmed time.

The app shell uses semantic HTML, keyboard-visible controls, local system fonts, and no third-party visual, analytics, or tracking asset. Unsafe tenant paths share one not-found view rather than reaching the API.

Windows Application Control blocks Rolldown native modules in the development environment. The repository pins one compatible Vite, Vitest, and Rolldown set and records Rolldown's matching WASI fallback. This keeps machine policy enforced while allowing deterministic local tests and builds; production browser output contains neither the build runtime nor its environment settings.
