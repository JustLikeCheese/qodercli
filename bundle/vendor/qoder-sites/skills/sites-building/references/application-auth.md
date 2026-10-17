# Application-owned login

Use this reference when the app needs an existing account service or third-party
login. Keep the default [platform user example](function-backend.md) for Qoder
identity. Do not replace existing login behavior automatically or add `authMode`.

## Choose one application verifier

Copy the complete [application-auth directory](../assets/application-auth/) into
the application workspace, outside the Function upload directory. OAuth and introspection examples
use the same private notes routes and different application verifiers:

| Example | Authentication | Required application Secrets |
| --- | --- | --- |
| `introspection` | Existing service validates a Bearer token | `APP_ORIGIN`, `APP_AUTH_INTROSPECTION_URL`, `APP_AUTH_SERVICE_TOKEN`, `APP_AUTH_ISSUER`, `APP_AUTH_AUDIENCE` |
| `oidc` + `web` | Auth.js Google OIDC / GitHub OAuth and encrypted Cookie sessions | `APP_AUTH_SECRET` plus the selected provider Client Secret |
| `password` | Application-owned username/password laboratory, database sessions | Fixed `APP_ORIGIN`; see password/README.md for limits |

For OAuth set the non-secret origin and Client IDs in
[site-config.mjs](../assets/application-auth/site-config.mjs); APP_ORIGIN and
APP_*_CLIENT_ID may override them through existing environment settings. Both auth
and business code use createEnv, so their origin cannot diverge. Empty configuration
fails closed; never infer the public origin from ingress headers.

Enter APP_AUTH_SECRET and the chosen APP_GITHUB_CLIENT_SECRET or
APP_GOOGLE_CLIENT_SECRET in Site Settings. Keep only names in secretNames; values
never enter source, ZIPs, tool arguments or logs. APP_AUTH_SECRET needs at least 32
random bytes and persists across deployments. Changing it invalidates old sessions.
A GitHub-only site with public configuration needs exactly two secret values.
The password laboratory has separate database sessions; it does not require this key.

The introspection adapter POSTs form `token` and `token_type_hint=access_token` to
a fixed HTTPS endpoint, authenticated with the service Bearer credential. It
requires JSON `active: true`, stable nonempty `sub`, exact `iss`, matching `aud`
(string or array), and future integer `exp`. This is an example-specific contract:
adapt it to your existing service's authentication and response contract. It does
not implement registration or issue user tokens. An unavailable verifier returns
503; invalid credentials return 401. There is no identity fallback or retry.

The OAuth example locks `@auth/core` 0.41.3 and `jose` 6.2.12. Configure the selected Google Web OAuth client or GitHub OAuth App with its exact callback URI:

```text
https://YOUR_SITE/functions/v1/app/auth/callback/google
https://YOUR_SITE/functions/v1/app/auth/callback/github
```

Copy the accompanying web/ frontend together with the Function. Its reusable
auth-forms.mjs acquires CSRF then submits a native same-origin POST for login and
logout. Keep browser navigation for provider redirects. Alternatively use Auth.js's built-in `/functions/v1/app/auth/signin` and `/auth/signout` pages
(the latter under the same Function prefix), including their CSRF-protected forms.
`/functions/v1/app/auth/session` reads the session; `/functions/v1/app/api/me`
requires an authenticated application user. GET callbacks only; POST/form_post is
not supported. No account association by email or provider token persistence is
included. Auth.js owns state, browser binding, PKCE, nonce and encrypted sessions;
`jose` additionally verifies Google's ID Token signature with fixed JWKS,
issuer, audience and RS256. Google identity is `google:<provider subject>`; GitHub uses `github:<numeric ID>`,
state + PKCE, client_secret_post and read:user only. Providers enable independently;
no email-based account merging. Register only the selected provider callback.

Session cookies use `__Host-app_auth.*`, Secure, HttpOnly, SameSite=Lax and Path=/.
The sample session lifetime is one hour; the Auth.js session endpoint can renew it.
Sign-out clears this browser's session; a copied encrypted token remains valid
until expiry. It does not log out Google or Qoder or instantly revoke stolen
sessions. Choose another mature session implementation if immediate revocation is
required. No platform session/account tables are introduced.

## Build and deploy

In the copied example directory, select an installed Node version accepted by `oidc/package.json` using [Local tools](environment.md#local-tools):

```sh
cd oidc
npm ci
npm test
npm run build
```

The build creates `dist/function/index.ts` for OAuth and
`dist/introspection/index.ts` for the existing-service example. Select exactly one
output directory as the Function directory. Dependencies are bundled locally;
there are no runtime npm downloads. Keep `index.ts` and `Deno.serve`. Do not upload
unbundled source, node_modules, tests, or `_qoder/`; Worker supplies `_qoder/backend.mjs`.
Publish web/ alongside dist/function/ for OAuth. The password/ directory has its
own web/, functions/, schema.sql and tests; it is a complete laboratory, not a
password recovery/account administration product. No real two-account acceptance
is claimed by copying either template.

For local HTTPS use [the local runner](../assets/application-auth/README.md).
Keep dev/, tests, certificates and dependency sources outside upload directories.

Use the [Function backend prerequisites](function-backend.md): verified trusted
entry, `function_backend`, database/functions capabilities, `databaseAccess:
read_write`, and `schemaRef` from get_database_schema with the same projectId. Apply the supplied
business-only [schema.sql](../assets/application-auth/schema.sql) through the
existing reviewed migration flow before deployment. It defines `app.app_notes`
with composite key `(owner_id, id)`; it is not an authentication schema.

The target Worker must include `forwardApplicationCredentials`. An old Worker SDK
can silently ignore the option and strip credentials, so verify the SDK capability
before deploying this example. Gateway response protection must also be deployed.
Existing deployed functions are not rewritten by a Worker upgrade.

Browser calls use same-origin `/functions/v1/app/api/notes`. Google sessions use
`credentials: 'same-origin'`; the existing-service example sends its user's Bearer
token. POST JSON `{ "title": "..." }` with a fresh UUID `Idempotency-Key`. Retain the
same key and exact payload for explicit recovery after an uncertain result; never
automatically replay a write on authentication/network failure. Never send owner ID.
Function filters reads and writes by the verified application user; Tenant RLS
isolates sites. A matching platform UID does not grant access to application data.

## Boundaries and acceptance

`createSiteContext(request, { forwardApplicationCredentials: true })` preserves
application credentials after stripping platform cookies and reserved headers.
Gateway strips all Function `Clear-Site-Data` response headers to protect platform
and sibling-site cookies; expire only the application cookies explicitly on logout.
The default still removes Cookie/Authorization; `ctx.user` and `requireUser()`
remain platform-only. Database requests use environment credentials exclusively.

A public site admits anonymous login pages; private/selected/organization sites
still require platform admission first. Do not change visibility automatically.
Fixed APP_ORIGIN controls generated URLs, not proof of the request's host. This
example does not isolate preview and production on the same Site; use separate
Sites/configuration when needed and verify that boundary before claiming support.

Local coverage includes actual Auth.js/jose with simulated Google responses,
invalid claims/signature/state, replay/concurrency, restart, CSRF, ownership and
idempotency. Deno bundle startup is a separate local check. These do not prove real
Google login, Provider Authorization pass-through, ingress closure, Tenant RLS,
hot Secret propagation, or browser Cookie behavior in the target environment.
Before production use, verify the complete browser flow on one configured formal
Host and ensure gateway/Provider/Function logs omit credentials and callback query.
Never log raw authentication errors. Only the actually verified Provider/library
combination may be marked accepted.

The shared route helper accepts both full `/functions/v1/app...` paths and
Provider-stripped `/app...` paths (including exact generated physical names).
OAuth URLs still use APP_ORIGIN and the public logical `/functions/v1/app` path.

For requested browser testing and final handoff follow [runtime acceptance](runtime-acceptance.md).
Authentication logs contain only fixed categories, stage, provider and a correlation ID;
unknown library errors become auth_failed. Raw library errors are never logged.
