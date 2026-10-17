# Username/password laboratory

A complete local example, not a managed identity product. It has no email,
password recovery or account administration. Local tests cover registration,
password derivation, sessions, owner filtering, rate limits and uncertain writes.
Live two-account isolation and Provider concurrency remain unverified.

The page keeps an uncertain note command and its idempotency key in memory,
bound to the original user. Session expiry and same-user reauthentication retain
that command even if the following list read fails; retry is always explicit.
Signing in as another user or explicitly signing out clears it. Closing or
reloading the page loses this in-memory recovery state; inspect existing records
before submitting a replacement command.

Set APP_ORIGIN through Site Settings (a fixed HTTPS origin, not a secret), or
set PUBLIC_ORIGIN in functions/http.mjs. Publish web/ and functions/ separately,
with databaseAccess=read_write and the actually applied schema version.
Apply schema.sql only to a new dedicated function_backend site; existing apps
must plan a migration from their actual schema. These tables need a retention
policy before sustained use: expired sessions and limiter rows accumulate.

Run `node --test test/check.mjs`. The fake database is test-only and never goes
in the Function directory. Supply real test accounts only at the user's handoff.
