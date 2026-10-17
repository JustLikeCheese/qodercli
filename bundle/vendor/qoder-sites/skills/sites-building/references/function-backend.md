# Function-owned backend

Use this path for new projects with persistent data. Business authorization and
data access live in Functions; the frontend calls same-origin business APIs.
Gateway-derived identity requires verified Gateway-only ingress. Local SDK tests
do not establish that direct Provider requests are blocked. For an explicitly
authorized limited test with unresolved ingress, retain that scope without
claiming production isolation; see [test scope](database-migration.md#choose-access-before-creating-a-plan).

For a new backend, call `ensure_backend` with database and functions capabilities
and `databaseAccessModel: function_backend`. An existing legacy allocation cannot
be switched in place. No `authMode` is configured: new packages are artifact v2,
and Function code decides which routes require login. Historical artifacts retain
their original deployment behavior until an explicit new deployment migrates them.

For a runnable starting point, assemble the [records and attachments workbench](records-example.md).
Its local mode executes the actual application routes with in-memory dependencies;
no cloud credentials are required. For an existing app, copy [index.ts](../assets/function-backend/index.ts) and
[routes.mjs](../assets/function-backend/routes.mjs) into the Function directory.
Copy [Notes.tsx](../assets/function-backend/Notes.tsx), [api.ts](../assets/function-backend/api.ts)
and [records.css](../assets/function-backend/records.css) together into the frontend
for same-origin `/functions/v1/app/api/...` requests, explicit create recovery,
versioned edits and signed attachments. The Function strips only the logical/local `app` or
platform-generated physical Function prefix before matching business routes,
with or without the Provider-stripped `/functions/v1` prefix;
do not include this React file in the Function ZIP. Keep [schema.sql](../assets/function-backend/schema.sql)
outside that directory and submit it through the existing reviewed migration flow.
The notes schema includes `(owner_id, created_at)` so the latest-100 query can
read the owner's index backward. For an existing installation of this example,
inspect its current indexes and add `notes_owner_created_at_idx` with
`CREATE INDEX notes_owner_created_at_idx ON app.notes (owner_id, created_at);`
in a separate reviewed migration if no equivalent index exists. Use the
schemaRef from a verified get_database_schema read for later preparations.
Read `get_site(include: ["backend"])` first. For `function_backend`, omit `accessPolicies` or pass
`[]`: AppHub generates fixed private policies. Do not copy the legacy public/owner
policy example. Read `get_database_schema` for the schemaRef and current structure,
create and inspect the plan, apply its exact planRef, then verify completion.
Storage uploads also require the separately authorized `storage` capability.
Declare `databaseAccess: read_write` and the verified schemaRef with the same projectId when
packaging. Do not include `_qoder/`: Worker supplies these platform modules before
deployment. Keep `index.ts` and `Deno.serve`; no new Handler format is required.

The platform injects `QODER_DATABASE` into Tenant Secrets before deploying. The
SDK reads it at every HTTP execution, never calls AppHub, and never retries writes
after a network failure or credential rejection. Do not read a user JWT as the
DB token, use service_role, supply an owner from JSON, or grant browser DB access.
The new database token has no expiry. The database enforces its version and
enabled state; there is no periodic rotation. Manual replacement requires a
maintenance window and Function redeployment; do not rely on hot Secret updates.
Only SDK 2 and the new credential format are supported; redeploy old test Functions.
All versions share the site's database identity. Database RLS isolates Tenant;
Function predicates enforce users, roles and resource ownership within the site.

The example includes an anonymous health endpoint, authenticated owner-scoped
reads (including the current identity, one record and its attachment list),
unique-key idempotent creation, and an owner/version conditional update.
It does not implement arbitrary transactions. For a response lost after creation,
repeat the same idempotency key and exact payload; for a conditional-update loss,
read the current row before deciding whether another command is appropriate.

The upload flow creates a pending owner-bound metadata row and a server-generated
object path, signs an upload without overwrite, verifies the stored size/type,
then marks it ready. Downloads look up ownership and readiness before signing.
The client cannot select another object's path. Pending rows and objects need an
application cleanup policy. Signed upload URLs may be reusable until expiry and
post-upload checks are not a pre-upload quota guarantee; verify Provider overwrite
semantics and file processing needs before allowing untrusted uploads. Signed URLs
are short-lived bearer capabilities: existing download URLs survive a permission
change until expiry. Do not log them or describe them as instantly revoked.

For local development, inject credential-free fake DB/Storage/context dependencies
into `application(...)`; exercise the actual routes. For SDK transport checks run
Worker's `runtime-sdk/backend.test.mjs`. This avoids inventing a local AppHub or
caching a real token in files. In a deployed request return a stable error and
request ID; inspect platform operation status for readiness. Never log raw Provider
errors, JWTs, Secret values or signed URLs. `database_not_configured`,
`database_credential_rejected` require platform
configuration or explicit credential recovery, not a browser login refresh or write replay.

For an existing account service or third-party login, use [Application authentication](application-auth.md). It keeps application identity separate from platform identity and database credentials.

An uploaded object that is still missing returns `upload_pending` (409); Storage
permission/network/provider failures return 503. Do not mark metadata ready in
either case or translate every Storage error into a missing file.


## Recovery and deployment updates

`get_site(include: ["backend"])` reports the access model and allocation state; it does not report
whether database credentials are currently enabled. Function metadata does not
expose the injected SDK version. Never infer either from `ready` or invent a
credential-management tool.

Suspending a Function-backend site revokes its database credential. Resuming site
publication restores entry only; it does not re-enable that credential. If data
access remains denied or reads unexpectedly become empty, preserve data and the
current release, record the safe operation/request ID, and ask the platform
administrator to inspect credential state and perform an authorized replacement.
The current Sites plugin has no administrator rotate/revoke entry. Re-login,
public grants, repeated migrations, and automatic business-write replay are not
credential recovery mechanisms.

After Worker SDK fixes or administrator credential replacement, redeploy the
Function in a new deployment and verify the affected business operation. Worker
upgrade alone leaves deployed SDK copies unchanged. There is no 24/12-hour token
rotation, no runtime renewal call, and no promise of hot Secret propagation.
