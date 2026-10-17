# Functions and Secrets

## Runtime contract

The Sites plugin packages a separate function directory as `runtime/app.zip`. Its entry point is `index.ts` at the ZIP root, its logical name is `app`, and its runtime is `edge`, with artifact `formatVersion: 2` and no `authMode` configuration. Database access defaults to `none`; an explicit dependency can declare `read_only` or `read_write` together with `schemaRef` from get_database_schema with the same projectId. Implement an HTTP handler, for example with `Deno.serve(...)`, rather than an Express startup command or persistent background process.

Use relative imports with explicit file extensions and package their dependencies with the directory. The plugin packager does not resolve TypeScript path aliases, transform Node-specific modules, install dependencies, or validate every import. Use the project's actual checking/build process for nonstandard dependencies; copying local `node_modules` into the function package is not a solution. Keep the entry point and dependencies self-contained without assuming an unavailable import map or remote download service.

## Browser calls

For WebSocket Upgrade, text/binary echo or a bidirectional relay, use [WebSocket in Sites](../../sites-build-agent-app/references/websocket.md). WebSocket is separate from the JSON/SSE response paths below; a local development proxy must enable `ws: true`.

For JSON business responses, reuse [the request helper](../assets/database-react/api.ts), including in plain JavaScript projects after removing TypeScript annotations. Preserve HTTP 401/403 handling, safe application/Gateway error mapping, and the distinction between error codes and successful business fields; adapt only copy and payload validation. It rejects login HTML and never displays raw server errors. Validate the successful payload at the call site:

```ts
const result = await requestJson('/functions/v1/app?name=Visitor');
if (!result || typeof result !== 'object' || !('message' in result)
    || typeof result.message !== 'string' || !('ok' in result) || result.ok !== true) {
  throw new Error('The site service returned an invalid result.');
}
// Render result.message with framework-escaped interpolation.
```


Logical subpaths such as `/functions/v1/app/orders` are supported. The gateway replaces the function-name segment with the upstream name for the published version, preserving the suffix and query. Do not assume the full pathname received by the function contains the logical name `app`. The minimal example handles one GET endpoint without depending on that path. For multiple application endpoints, explicitly adapt to the actual runtime request path; include a representative subroute in the main-flow check when routing changes. Unknown paths must not all return success.

If the logical entry point fails, report the failed request accurately. Do not guess physical function names or Provider URLs, or introduce browser `runtime.json` as a workaround. Management PATs/JobTokens, tenant-routing headers, and Provider credentials must stay out of browser requests. Client-supplied user IDs, `X-Instance-ID`, and Origin are not verified application identities.

For writes, explicitly validate methods, body type/size, input, and application permissions; GET must not mutate state. Third-party API calls should use fixed trusted server-side destinations, timeouts, and filtered responses. Do not turn arbitrary user URLs into credential-bearing proxy targets. Do not automatically replay POST/PATCH or other application writes after network failures. Production origin protection and prevention of entry-point bypass require separate acceptance; a successful same-origin request does not establish that those security gates are complete.

## Site access and visitor identity

The Sites Gateway checks private/selected/organization access against signed identity and the current site/host access snapshot before forwarding Function requests; writes also require same-origin checks. Function code decides which business routes require login; the artifact does not configure this decision. Legacy artifacts retain their existing deployment behavior until explicitly migrated. For an owner-only application, verify the exact protected ingress and provider bypass protection before deciding whether site-level authorization is sufficient. Per-user records require a verified application identity; public sites need application access and usage controls.

Browser `GET /__qoder_auth/me` returns login information (`user_id`, `name`, `picture`, `site_id`, `host_id`, `session_expires_at`), not a current site access decision or transferable proof. Upgraded Gateway verifies its short-lived Identity locally and refreshes it through AppHub when needed. Identity state may lag revocation/profile changes by up to 10 minutes.

Upgraded Gateway verifies the Identity and site/host binding, enforces site access, strips browser-supplied `x-qoder-*` and platform cookies, then injects `x-qoder-user-context` only into Function requests. Read it using [the server user SDK](../assets/user-context/auth.mjs); copy it into the Function directory and import `./auth.mjs`. This is a bundled source file, not an injected `_qoder` module. [The complete identity endpoint](../assets/user-context/index.ts) uses the same file. Browser calls remain same-origin with `credentials: 'same-origin'`; no PAT or identity header is supplied by the browser.

- `getUser(request)` returns the current user or `null` when context is absent; `requireUser(request)` raises `login_required` (401) when absent. Both reject malformed or expired context with `invalid_user_context` (403). Handle these errors inside the business handler before the database adapter's generic error boundary.
- Public sites may have anonymous visitors. Old Gateway/Identity versions also omit context: confirm rollout before diagnosing every missing context as a logged-out user. Gateway auth dependency failures remain failures, not anonymous fallbacks in application code.
- The SDK validates format, not a signature. An isolation guarantee requires verified protection against forged context through provider direct access, alternate ingress and cross-tenant routes. For a limited functional test, apply the explicit [test-scope decision](database-migration.md#choose-access-before-creating-a-plan) and report the unverified boundary separately. Local fixture headers stay outside deployed endpoints.
- Use `user_id` from this request for ownership; ignore owner fields submitted by the browser. Name and picture are optional display content (empty strings allowed); escape text and apply the application's image URL policy. Do not cache the context across requests or use `session_expires_at` as a reusable credential lifetime.

For persistence, follow [Database identity and coordination](database.md#identity-and-coordination). Gateway identity does not set Supabase `auth.uid()` or establish business-object access by itself.

For a complete frontend, profile handler and local two-user exercise, use [Current user and site profile](user-profile.md).

## Secret configuration

For Qoder Cloud Agents, use [sites-build-agent-app](../../sites-build-agent-app/SKILL.md): the `qoder` backend provisions `QODER_PAT` for runtime reads. It is a platform Secret, not an application Secret to declare or enter through Settings.

When third-party credentials are needed, read an **application** Secret with `Deno.env.get('APP_API_KEY')`. If it is missing, return a stable application error such as `service_not_configured`. Do not print environment variables or return values, digests, or raw upstream exceptions.

1. Declare the names the code actually depends on in `prepare_site.secretNames`, up to 100. Names follow `[A-Z_][A-Z0-9_]{0,127}`; prefixes `QODER_`, `SUPABASE_`, `POSTGRES_`, and the name `DATABASE_URL` are reserved for the platform.
2. Functions backend allocation requires user authorization and is requested by the tool only when preparing a function. After preparation, wait for Functions readiness in Portal Settings, enter Secrets through the dedicated input, and confirm successful synchronization before publishing a dependent version. Settings does not automatically allocate a backend for a static site.
3. Keep Secret values out of source, tool arguments, chat, command lines, build variables, and frontend artifacts. If the user requests local credential validation, have them provide credentials through an existing secure environment configuration. Default examples use credential-free handlers or substitutes with no sensitive data.
4. Use Portal version and synchronization feedback for replacement or deletion. Names referenced by an active release may not be deletable; adjust dependencies in a new version and publish normally before removing them, without bypassing platform constraints.

Anonymous runtime alone does not provide per-user authorization; use the verified user context and enforce business ownership for database or Storage access. This skill does not introduce internal platform Secrets, database connection strings, or tenant headers as substitutes.

## Database and Storage dependencies

For database client initialization, the bundled adapter, queries, pagination, mutations and local verification, read [Database access from Functions](database.md).

Use [sites-management](../../sites-management/SKILL.md) for backend readiness and reviewed database migrations. For a database-dependent Function, set `prepare_site.databaseAccess` to `read_only` or `read_write`, and pass the verified `schemaRef` with the same `projectId`. The plugin binds the schema dependency internally and the packager never embeds or applies SQL. Omit schemaRef for `none`. An enabled backend alone does not establish that the schema or the Provider's physical access restriction is ready. Use the main-flow request to verify runtime integration in the target environment, and check the affected access boundary when permissions change; do not invent database URLs or credentials.

For Storage method signatures, application authorization, browser signed transfers and validation, read [Storage in application Functions](storage.md).

For application Storage, explicitly enable the Storage capability with `ensure_backend`, wait for its operation and verify `get_site(include: ["storage"])`. The trusted Worker injects the SDK at deployment:

```ts
import { storage } from './_qoder/storage.mjs';

// Invoke only after the application's own authorization has succeeded.
const files = await storage.list('uploads', { limit: 20, offset: 0 });
```

Do not package an `_qoder` directory or declare/read `QODER_STORAGE` yourself. The SDK is an intentional injected import. Put a credential-free fake in `dev/` and pass it into the business handler from a separate local entry point. Never create `functions/_qoder`, including for type checking: the packager rejects it rather than omitting it. Check the handler with the local adapter; only the deployed runtime resolves the platform import. A fixture check is not a Provider integration test. The SDK also supports `upload`, `download`, `remove`, `createSignedUploadUrl`, and `createSignedUrl`; signed URLs are root-relative paths for the current site origin. Application permission checks must precede each operation or signature issuance. Do not make an unrestricted anonymous file manager. Owner CLI file tools are for authorized administration and do not confer visitor access.

## Local validation

The [minimal function entry point](../assets/function/index.ts) and [handler](../assets/function/handler.ts) have no dependencies or credentials and return only a public greeting, making them suitable for connection checks. Copy both files into the project's `functions/` directory, keeping `Deno.serve(handler)` in the deployment entry point.

Follow [Function checks and missing-tool handling](environment.md#local-tools). After `deno --version` succeeds, place this local entry point in `dev/function-local.ts`, outside the function directory so it stays out of the publication package:

```ts
import { handler } from "../functions/handler.ts";

Deno.serve({ hostname: "127.0.0.1", port: 8000 }, handler);
```

Run from the project root:

```bash
deno check functions/index.ts
deno run --allow-net=127.0.0.1:8000 dev/function-local.ts
curl --fail 'http://127.0.0.1:8000/functions/v1/app?name=Visitor'
```

The last command is an example for environments with `curl`; an available HTTP tool or Node `fetch` can make the same request and verify its status and response.

Configure a same-origin proxy in the frontend development server, pointing `/functions/v1/app` to the local Deno service while preserving the path. An existing Vite project can use this configuration fragment:

```js
server: {
  host: '127.0.0.1',
  proxy: { '/functions/v1/app': 'http://127.0.0.1:8000' },
}
```

The Vite proxy is for local development; production routing belongs to the platform. A plain static server neither executes TypeScript nor proxies Functions. Without a proxy, validate the static page and function separately rather than treating a local 404 as a cloud failure. Record the frontend and handler checks actually executed and their results.

Follow the [validation scope](../SKILL.md#validation-scope). Use one representative request through the actual application handler and its required dependencies, reusing the same-origin request after authorized publication when available. Check invalid input, method rejection, missing dependencies or denied access when the corresponding handling changes or a bug requires it. These are targeted checks, not a mandatory suite for every Function.

For an existing account service or third-party login, use [Application authentication](application-auth.md). It keeps application identity separate from platform identity and database credentials.


## Deployed diagnostics and optional platform login

For authorized inspection of deployed behavior, use sites-management's
`get_function_logs(type: requests)`, `get_function_logs(type: output)`, and `query_database_rows`.
See [Owner diagnostics](../../sites-management/references/data-and-logs.md).
These tools are for the site Owner; application browsers continue using Functions.

Public access does not disable login or invalidate a valid session. An anonymous
visitor can enter public pages and choose to sign in. On an API 401, offer top-level
navigation to `/__qoder_auth/start?return_path=...` with a URL-encoded local return
path. A 403 means no access; a 503 means a temporary dependency failure, not a reason
to repeatedly log in. Public Functions may receive anonymous context when identity
renewal fails; private business routes still require verified identity. Changing
sharing to public must not trigger an application-side logout.
