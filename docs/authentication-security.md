# Authentication security decisions

## Password policy

While passwords are the only authentication factor, calenolav requires 15–128 Unicode code points. It permits spaces and does not require arbitrary mixtures of uppercase letters, numbers, or symbols. Passwords are passed unchanged to the hasher.

This follows [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html), which requires at least 15 characters for single-factor passwords, recommends allowing at least 64, and rejects composition rules.

## Password storage

Passwords are salted and hashed with Node's built-in scrypt using `N=2^17`, `r=8`, and `p=1`. The stored value includes the algorithm and work factors so hashes can be upgraded after a successful future sign-in.

These are the minimum scrypt parameters recommended by the [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Raw passwords are never logged or persisted.

## Session secrets

Each session uses 32 cryptographically random bytes encoded as base64url. The raw token is returned once in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. PostgreSQL stores only its SHA-256 digest, so a database read does not directly reveal usable session credentials.

Secure cookies default to enabled. `COOKIE_SECURE=false` is allowed only for deliberate local HTTP development; deployed environments must terminate TLS and retain the default.

Registration creates the user, tenant, owner membership, and session inside one PostgreSQL transaction. Unique email or slug conflicts roll back every write and return one generic response.
## Sign-in and session lifecycle

Sign-in normalizes the email address but passes the password unchanged to scrypt. Unknown accounts and incorrect passwords return the same `invalid_credentials` response. A valid dummy scrypt hash is checked when an account is absent so both paths perform comparable password work.

Sessions expire after 30 days. Authenticated lookup hashes the presented cookie, rejects missing, expired, or revoked sessions with one `invalid_session` response, records `last_seen_at`, and returns only the user's identity and tenant memberships. Tenant authorization requires both a matching tenant identifier and a sufficient membership role.

Sign-out stores the first revocation time, remains safe to repeat, clears the cookie, sends `Clear-Site-Data`, and prevents the response from being cached. Registration, sign-in, session lookup, and sign-out responses all use `Cache-Control: no-store`.
