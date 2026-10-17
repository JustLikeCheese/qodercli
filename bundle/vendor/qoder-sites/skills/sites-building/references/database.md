# Database access from Functions

For all new projects with persistent data, use [Function backend](function-backend.md). This reference maintains existing `legacy` allocations only; its anonymous adapter does not use the platform private database credential.

Use the Supabase JavaScript client supplied to the business handler by the bundled adapter. Keep queries in the Function; the browser calls the same-origin `/functions/v1/app` endpoint.

## Prepare the schema

For a complete SQL and `accessPolicies` example, follow [Create the notes schema and access policy](database-migration.md). For a brand-new project, follow [First publication with a database](../../sites-hosting/references/deployment.md#first-publication-with-a-database) before cloud schema operations.

Use [sites-management](../../sites-management/SKILL.md) to enable the database, inspect its current schema, and create and apply the authorized migration with explicit `accessPolicies`. For the example below, create a `notes` table with `id` (UUID primary key), `title` (text), and `created_at` (timestamp with time zone). Resolve its logical schema and access policy through the migration tools; the example queries the runtime's exposed default schema.

Grant anonymous SELECT only for records intended to be public, apart from an explicitly accepted [limited functional test](database-migration.md#choose-access-before-creating-a-plan). For private records or writes, resolve [identity and coordination](#identity-and-coordination) before selecting access policies.

Set `prepare_site.databaseAccess` to `read_only` for this example and `schemaRef` to the reference from get_database_schema after verifying the applied migration. Use `read_write` only for an authorized application that writes data. These declarations accompany the schema and policy configuration; they do not create tables or grant access.

## Identity and coordination

Declarative policies support `deny`, `public` and authenticated `owner`; owner policies compare `auth.uid()` with the declared owner column. The bundled adapter accepts only anonymous mode and uses `SUPABASE_ANON_KEY` for API key and Bearer authentication. It does not translate Sites login or `QODER_PAT` into a Supabase user, so it alone cannot satisfy an owner policy. Apply the [Function identity boundary](functions.md#site-access-and-visitor-identity); browser-supplied user IDs and process-local Maps do not establish ownership of durable records. Do not use anonymous public CRUD as the production access policy for private bindings or repurpose platform/service-role credentials to bypass a missing identity contract. Use a verified application backend when the required contract is unavailable; an explicitly accepted limited functional test follows the scope rules in [the migration workflow](database-migration.md#choose-access-before-creating-a-plan).

Primary/unique constraints can reject duplicate keys. A filtered update can provide single-row compare-and-set only after verifying affected-row results and target provider behavior. Multiple SDK calls are not one transaction. In particular, checking a lease row and then writing another binding row is not atomic fencing; the protected write itself must reject a superseded lease in the same atomic operation. Custom database functions are outside the [supported migration interface](database-migration.md#supported-sql); the SDK's `.rpc()` method does not establish that an application RPC is installed. Worker migration transactions, advisory locks and the migration ledger are management internals, not a Function transaction API.

For requests to view existing business records, follow [Viewing stored records](../../sites-management/SKILL.md#viewing-stored-records) for the management capability boundary and application-query path.

Management reads establish database state and table/index structure. Read the applied migration for declared access policies; the table catalog does not report live RLS enforcement. Verify private access and required concurrency through the intended Function within the authorized test scope. Do not create resources or apply migrations solely for diagnosis without authorization; metadata and local fixtures do not prove runtime enforcement.

## Copy the database Function

Copy all three files from [assets/database-function](../assets/database-function/index.ts) into the project's dedicated Function directory:

```text
functions/
  index.ts
  adapter.mjs
  handler.mjs
```

The [entry point](../assets/database-function/index.ts) pins `@supabase/supabase-js` to `2.57.4`, creates the request handler with [serveSite](../assets/database-function/adapter.mjs), and passes it to `Deno.serve`. Package the adapter and handler alongside the entry point; the adapter is a bundled source file. Use `functionDirectory: "functions"` when preparing this layout. Keep local test entry points outside this directory.

The adapter creates a fresh client for each request and handles runtime configuration and routing. Business handlers receive `{ request, supabase }`. Keep the adapter unchanged; never accept database endpoints, credentials, schema names or platform routing headers from browser input. Do not add platform database credentials to `secretNames`, project files or frontend code. Database policies remain responsible for data access enforcement.

The [handler](../assets/database-function/handler.mjs) implements:

```http
GET /functions/v1/app?action=list&offset=0
```

It selects explicit columns, applies a stable two-column order, fetches 21 records for a 20-record page, and returns `{ items, hasMore, nextOffset }`. Continue only when `hasMore` is true. Offset pagination reflects current data and can shift during concurrent changes; use an application cursor when a stable traversal is required. Invalid pagination returns 400, unknown actions 404, unsupported methods 405, and database failures a fixed 503 error without raw provider details.

## Connect the React page

For a React starter project that needs a public read-only list, use [the database page](../assets/database-react/App.tsx) with the three-file Function above. Copy `App.tsx` and its sibling `api.ts` into `src/` for a new page, or integrate its request and state handling into the existing design. It requests the same-origin Function, checks JSON and result shape, handles loading/empty/error states, provides retry and pagination, and cancels obsolete reads. Adapt its title, copy and record fields to the product; it contains no simulated records or database credentials.

Create the `notes` schema and anonymous SELECT policy through [the migration workflow](database-migration.md). Build the frontend into `dist`, then prepare with `webDirectory: "dist"`, `functionDirectory: "functions"`, `databaseAccess: "read_only"` and the verified `schemaRef` with the same projectId. Follow sites-hosting through publication and preview. Verify the deployed read separately; the publication preview cannot execute Functions.

For local development, use the existing [fixture preview](#ready-to-run-local-preview) as the Vite Function proxy target. State clearly when records come from that fixture. An empty deployed table should show the empty state; do not widen its write policy or insert sample rows merely to fill the page. Add requested writes with application authorization and the mutation patterns below, rather than exposing the example as unrestricted public CRUD.

## Query and mutation patterns

Use these Supabase SDK operations inside the Function. HTTP methods in this table are the outgoing database requests, not the browser's application endpoint contract.

| Operation | SDK pattern | Database HTTP method |
| --- | --- | --- |
| Read, filter, paginate or check existence | `.select(...)` with validated filters and a bounded result | GET |
| Exact count | `.select('id', { count: 'exact' }).limit(1)` | GET |
| Create | `.insert(...)` | POST |
| Update selected rows | `.update(...).eq(...)` | PATCH |
| Delete selected rows | `.delete().eq(...)` | DELETE |

Do not use HEAD requests or SDK `head: true` options for database reads, counts or existence checks. Use the GET patterns above. This rule applies to Function-to-database access, not static assets or all Sites HTTP endpoints. The pinned SDK can normalize a database HEAD 404 into `status: 204` with `error: null`; neither an absent SDK error nor a 2xx SDK status proves that the requested result exists. Validate the required data/count as well. Keep browser calls on the site's Function endpoint; do not expose direct database URLs.

Use fixed table/column names and validated values. The following calls belong inside a business handler; adapt them to the reviewed schema. Supabase queries return `{ data, error }`: check `error` before claiming success and handle thrown transport errors as well.

```js
// Read a specific row. null means no visible matching row.
const result = await supabase.from('notes')
  .select('id,title,created_at').eq('id', validatedId).maybeSingle();
```

For mutations, first verify the application's authorization for the exact operation and target. Use POST/PATCH/DELETE as appropriate, validate JSON type and a bounded body size, whitelist editable fields, and validate IDs and title length. The following are database calls, not public mutation endpoints:

```js
// Create: generate the ID in trusted application code.
const created = await supabase.from('notes').insert({
  id: crypto.randomUUID(), title: validatedTitle,
  created_at: new Date().toISOString(),
}).select('id,title,created_at').single();

// Update: validatedId must also be an authorized target.
const updated = await supabase.from('notes')
  .update({ title: validatedTitle }).eq('id', validatedId)
  .select('id,title,created_at').maybeSingle();

// Delete one authorized row; never omit the filter.
const deleted = await supabase.from('notes')
  .delete().eq('id', validatedId).select('id').maybeSingle();
```

A null update/delete result means no visible matching row was changed; do not report it as a successful change. Mutation calls that request returned rows also need the appropriate SELECT policy. Preserve database errors as safe application error codes, without returning SQL, keys, routing headers or raw error messages. For idempotent writes, scope the key to the authorized principal and operation and persist a fingerprint of normalized, validated content. The same key and content returns the existing result; changed content returns a conflict. Enforce uniqueness in storage and reconcile a race by reading the winning record and checking its fingerprint. A versioned edit must filter on both the authorized ID and expected version, increment the version, and check the affected row; a mismatch preserves the user’s edit and offers the latest version. Do not automatically retry writes after an unknown network result; reconcile with the original key. Execute schema changes through `sites-management`, not through HTTP handlers.

## Exact counts

Read the exact count with a bounded GET result:

```js
const result = await supabase.from('notes')
  .select('id', { count: 'exact' })
  // Add the application's validated scope filters here.
  .limit(1);
if (result.error || !Number.isSafeInteger(result.count) || result.count < 0) {
  throw new Error('count_unavailable'); // Map to a safe application response.
}
const total = result.count;
```

The total comes from the SDK's count (Content-Range); `.limit(1)` bounds returned rows, not the total. Preserve the required ownership and scope filters. Do not substitute `data.length`, `count ?? 0` or a swallowed query error for an unavailable count.

When a write is followed by a count/read, distinguish rejected writes, unknown write outcomes, and confirmed writes whose subsequent read failed. A failed read does not undo a successful write. A Function-to-database timeout is also an unknown outcome, even if the browser receives a JSON 503; preserve that classification through the Function. Let the UI refresh the read without repeating the mutation; unknown writes require reconciliation with the original operation identity. If a list read is in flight when a write completes, queue a refresh or invalidate the older request instead of silently dropping the refresh. Offset pages can shift under concurrent edits; use a stable cursor when that would violate the requested behavior.

For diagnosis, retain the failing phase, HTTP method/status when available, and an allowlisted database error code in safe server diagnostics. Do not log credentials, headers, SQL, record content or raw Provider errors. A generic application 503 alone does not identify the failed database operation.

## Local preview and verification

When adding or changing the Deno entry point or SDK dependency, follow [Function checks](environment.md#local-tools). With Deno available, run `deno check --node-modules-dir=none functions/index.ts` if the existing build does not check it. This uses Deno's dependency cache independently of the frontend's `node_modules`. If local fixtures are needed for the main-flow check, inject a credential-free fake `supabase` client directly into `handleNotes`; keep this fixture and its local server entry point outside the Function directory. Label fixture records as local sample data. Do not fabricate platform headers or copy cloud database credentials to make local requests pass through the deployment adapter.

Use the frontend development server's same-origin proxy described in [Functions and Secrets](functions.md), then follow the [validation scope](../SKILL.md#validation-scope). Check the requested read or write path; for hosted delivery use an authorized record through the site's logical Function endpoint. Add a denied-operation check when access policies change, or an unknown-result check when write recovery changes. Pagination, empty results and error handling need separate checks only when affected. Local fixtures establish application behavior, not real database connectivity or policy enforcement.

When fixing count-query compatibility, exercise the Function's pinned Supabase SDK with a controlled fetch response: verify GET, a bounded result and an exact total larger than the returned row count. Cover failed/missing counts and, if affected, a successful write followed by a failed read without replaying the write. A fake `select()` that always returns a number cannot test the HTTP contract. This focused local check does not replace the authorized deployed request or require a new suite for every database feature.

## Ready-to-run local preview

Copy [server.mjs](../assets/database-preview/server.mjs) and [index.html](../assets/database-preview/index.html) into `dev/database-preview/`, alongside the existing `functions/` directory. From the project root run:

```bash
node dev/database-preview/server.mjs functions/handler.mjs 8000
```

Wait for the printed URL to respond; use it for local preview and testing. The standalone preview serves the real `handleNotes` handler with 25 local fixture records. Use the first page for the normal read path; the next page and Empty/Database error choices are available for targeted checks when those behaviors change. It also serves `/functions/v1/app`; point an existing frontend's development proxy to this server to test the actual application UI. Choose another free port if 8000 is occupied and use the printed URL. Keep the process alive during review. Both files belong in `dev/`, outside `webDirectory` and `functionDirectory`; fixture switches and sample data are local-only.

### Using the current Qoder user

Copy [auth.mjs](../assets/user-context/auth.mjs) alongside the database Function files and call `requireUser(request)` inside the business handler. The supplied adapter preserves `x-qoder-user-context` while removing routing headers. Catch `UserContextError` there and return its safe code/status; otherwise the adapter turns uncaught errors into a generic 503.

Use [the complete profile example](user-profile.md) for the schema shape, frontend form, read/save handlers and local two-user exercise. It derives ownership server-side and returns the persisted row; it does not grant database access or replace RLS.

### Mutation UI and recovery

Reuse [requestJson](../assets/database-react/api.ts) for application responses. Map known public error codes to product-language messages, including non-2xx JSON responses; keep raw provider errors server-side. Preserve form input on failure and disable duplicate submission while pending. After a confirmed write, refresh the authoritative record/list and dependent summaries; a success toast alone does not update data. Distinguish a refresh failure from a failed write so retrying the read cannot repeat the mutation.

For a timeout, lost response or partial multi-step write, reconcile by the original operation key before offering another write. Keep that key for the same intent; a changed payload is a new intent. Model multi-step work with durable progress and resumable steps when the requested behavior permits partial completion. Precheck/write/postcheck/compensate is not strict atomic exclusion: compensation can fail and concurrent requests can both pass. If strict atomicity is required, establish an available atomic provider operation before implementing the flow; explain a missing capability rather than promising it from sequential SDK calls.
