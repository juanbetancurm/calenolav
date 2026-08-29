# Google OAuth security decisions

## Server-side authorization flow

Google Calendar authorization is initiated only after a signed-in owner explicitly chooses to connect a calendar. The backend will request offline access so scheduled availability checks and bookings can continue when the owner is absent. Every authorization request uses a cryptographically random `state` value and a PKCE verifier.

The database stores only the SHA-256 digest of `state`. The PKCE verifier must be recovered for the authorization-code exchange, so it is stored as an authenticated-encryption envelope during the short-lived attempt. An attempt belongs to an existing `(tenant_id, user_id)` membership and must expire after it is created.
## Authorization start endpoint

`POST /tenants/:tenantId/google/oauth/start` requires a valid server-side session and an owner membership for that exact tenant. It creates a ten-minute attempt and responds with `303 See Other`; the Google authorization URL is carried only in the `Location` header. Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

The production routes are registered only when client ID, client secret, redirect URI, current key version, and key ring are all configured. Supplying only part of that set stops startup with a structural error. Omitting the entire set keeps Google OAuth disabled and both routes unavailable.

## Callback endpoint

`GET /google/oauth/callback` is public because Google redirects the browser to it. Authentication comes from the one-time state digest and encrypted PKCE verifier rather than an ambient session cookie. PostgreSQL uses `DELETE RETURNING` so only one concurrent callback can consume an attempt, and expired or replayed attempts fail before provider exchange.

The backend exchanges the code with PKCE, verifies the signed ID token for the configured client ID, requires a verified email and every Calendar scope, and stores only the encrypted refresh token. Provider denial, invalid state, expiry, cryptographic failure, incomplete identity, insufficient scopes, and token-exchange failure share one privacy-safe response. Callback responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Token storage

Google refresh tokens are long-lived credentials and are encrypted at rest. The schema stores separate ciphertext, 96-bit IV, 128-bit authentication tag, and key-version fields. Key material is never stored in PostgreSQL or committed to Git; local development will load it from the ignored environment file and production will use a secret manager.

Short-lived access tokens are not persisted or returned by the OAuth adapter. Future Google Calendar calls will obtain them when needed and keep them only in process memory.

## Connection status and disconnect

`GET /tenants/:tenantId/google/connection` and `DELETE /tenants/:tenantId/google/connection` require a valid session and owner membership for that exact tenant. Status responses contain only account email, calendar ID, granted scopes, and connection timestamps; encrypted credential fields are never selected or serialized. Both responses disable caching and referrer disclosure.

Disconnect uses one tenant-scoped `DELETE RETURNING` statement, so local credential removal is atomic, idempotent, and authoritative. When complete OAuth configuration is available, the returned envelope is opened with its tenant-specific refresh-token context and the official Google client attempts to revoke the grant. Missing configuration, decryption failure, or provider failure cannot restore the deleted row or expose provider details to the caller.

## Encryption keys and rotation

OAuth secrets use AES-256-GCM with a new 96-bit IV for every encryption. The authentication context includes the secret purpose and tenant identifier, so an envelope copied to another tenant or column cannot be opened successfully.

`OAUTH_ENCRYPTION_KEYS` is a comma-separated key ring in `version:base64url` form. Every decoded key is exactly 32 bytes and uses canonical, unpadded base64url. `OAUTH_ENCRYPTION_CURRENT_KEY_VERSION` selects the key for new ciphertext. During rotation, add the new version, make it current, retain older keys while their rows still exist, and re-encrypt those rows before retiring an old key.

The parser rejects missing, duplicate, malformed, or incorrectly sized entries without including supplied key material in its errors. Real keys stay in the ignored `.env` file for local development and in a production secret manager when deployed.

## Scope policy

The application requests `openid` and `email` only to verify Google identity. Calendar authorization remains limited to availability access plus event management on calendars the user owns, and the connection records the scopes actually granted. Features must remain disabled when their required scope was not granted.

These decisions follow Google's [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth security best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), and [Calendar scope guidance](https://developers.google.com/workspace/calendar/api/auth).
