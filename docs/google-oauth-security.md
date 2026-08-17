# Google OAuth security decisions

## Server-side authorization flow

Google Calendar authorization is initiated only after a signed-in owner explicitly chooses to connect a calendar. The backend will request offline access so scheduled availability checks and bookings can continue when the owner is absent. Every authorization request uses a cryptographically random `state` value and a PKCE verifier.

The database stores only the SHA-256 digest of `state`. The PKCE verifier must be recovered for the authorization-code exchange, so it is stored as an authenticated-encryption envelope during the short-lived attempt. An attempt belongs to an existing `(tenant_id, user_id)` membership and must expire after it is created.

## Token storage

Google refresh tokens are long-lived credentials and are encrypted at rest. The schema stores separate ciphertext, 96-bit IV, 128-bit authentication tag, and key-version fields. Key material is never stored in PostgreSQL or committed to Git; local development will load it from the ignored environment file and production will use a secret manager.

Short-lived access tokens are not persisted. They will be obtained from Google when needed and kept only in process memory. Disconnecting a calendar must revoke the Google grant when possible and permanently delete the local connection.


## Encryption keys and rotation

OAuth secrets use AES-256-GCM with a new 96-bit IV for every encryption. The authentication context includes the secret purpose and tenant identifier, so an envelope copied to another tenant or column cannot be opened successfully.

`OAUTH_ENCRYPTION_KEYS` is a comma-separated key ring in `version:base64url` form. Every decoded key is exactly 32 bytes and uses canonical, unpadded base64url. `OAUTH_ENCRYPTION_CURRENT_KEY_VERSION` selects the key for new ciphertext. During rotation, add the new version, make it current, retain older keys while their rows still exist, and re-encrypt those rows before retiring an old key.

The parser rejects missing, duplicate, malformed, or incorrectly sized entries without including supplied key material in its errors. Real keys stay in the ignored `.env` file for local development and in a production secret manager when deployed.

## Scope policy

The application will request Calendar access only in context and record the scopes actually granted. The initial target is availability access plus event management on calendars the user owns. Features must remain disabled when their required scope was not granted.

These decisions follow Google's [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth security best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), and [Calendar scope guidance](https://developers.google.com/workspace/calendar/api/auth).
