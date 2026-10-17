# Publication workflow examples

Read only the example that matches the current task. These examples illustrate
the [publication decisions](../SKILL.md#short-publication-path) and
[deployment contract](deployment.md); they add no approval or validation gate.

Operation headings name Sites CLI operations, except Desktop's preview MCP
`show_publish_confirmation`. Input blocks are complete argument
examples; response blocks are **cropped examples of parsed tool JSON**, not full
responses or evidence that an operation ran. Replace every `<PLACEHOLDER>` before
calling a tool. Copy actual returned identifiers and opaque references unchanged.

| Placeholder | Source |
| --- | --- |
| `<ROOT>` | The selected site directory inside `get_context.local.projectRoot` |
| `<ACTION_A>`, `<ACTION_B>`, `<BOOTSTRAP_ACTION>` | Distinct new UUIDs for distinct frozen drafts; retain each on retry |
| `<PROJECT>`, `<SITE>` | Preparation's `projectId`/`siteId`, or the intended cloud-verified local entry |
| `<PUBLISH_OP>`, `<BACKEND_OP>`, `<MIGRATION_OP>` | The corresponding tool's returned Operation ID |
| `<ENSURE_REQUEST>`, `<PLAN_REQUEST>`, `<CLIENT_MIGRATION>`, `<APPLY_REQUEST>` | Distinct UUIDs generated once for those write intents |
| `<SCHEMA_BEFORE>`, `<SCHEMA_AFTER>`, `<PLAN_REF>` | Exact opaque references from the specified read or plan result |
| `<MIGRATION>` | The plan result's `migration.migration_id` |
| `<REVIEWED_SQL>` | The reviewed SQL text read from the linked source file, not its path |

## First publication, then an update

Request: “Publish this photography page.” The completed static output is `dist/`
with `index.html`, and local validation already passed. No backend is required.

1. **`get_context`** — reuse a current result when available.

<!-- tool-input: get_context -->
```json
{}
```

Cropped response for this new, unbound directory:

```json
{"local":{"projectRoot":"<ROOT>","sites":[]}}
```

Proceed only after checking the full result for unavailable or ambiguous entries.
An empty `sites` list alone is not permission to replace an existing binding.

2. **`prepare_site`** — preserve this exact input for recovery.

<!-- tool-input: prepare_site -->
```json
{
  "actionId":"<ACTION_A>",
  "projectRoot":"<ROOT>",
  "webDirectory":"dist",
  "displayName":"Photography",
  "slug":"photo-journal"
}
```

Cropped response:

```json
{"actionId":"<ACTION_A>","projectId":"<PROJECT>","siteId":"<SITE>","descriptorStatus":"written"}
```

`written` reports the local descriptor, not publication. A pending or failed
descriptor follows [recovery](deployment.md#recovery), keeping this action.

3. **`get_publish_status`** — read the prepared action once.

<!-- tool-input: get_publish_status -->
```json
{"actionId":"<ACTION_A>"}
```

Cropped ready response:

```json
{"actionId":"<ACTION_A>","artifactReady":true,"dependenciesReady":true,"blockers":[],"canPublish":true,"published":false,"readiness":"draft_checks","retryAfterMs":null}
```

4. **`publish_site`** — the user's publication request already covers this step.
Use the ready result above; another unchanged preflight read is unnecessary.

<!-- tool-input: publish_site -->
```json
{"actionId":"<ACTION_A>"}
```

Cropped receipt:

```json
{"actionId":"<ACTION_A>","publishOperationId":"<PUBLISH_OP>"}
```

5. **`get_publish_status`** with the same input as step 3. While the Operation is
pending, wait the returned `retryAfterMs` and read this action again. The receipt
alone is not success. The successful current-publication result includes:

```json
{"actionId":"<ACTION_A>","publishOperationId":"<PUBLISH_OP>","operation":{"operation_id":"<PUBLISH_OP>","state":"succeeded","committed":true},"published":true,"canPublish":false,"dependenciesReady":null,"readiness":"publication_completed"}
```

6. After required integration checks, CLI/Wake return the verified status and `site.url`. **Desktop only:** call the MCP `show_publish_confirmation` for the same action.

<!-- tool-input: show_publish_confirmation -->
```json
{"actionId":"<ACTION_A>"}
```

On Desktop, use the actual `filePreview` and return its `deliveryMarkdown`
verbatim as the sole final delivery entry. On CLI, `status: published` and the
returned `site.host` identify the live result; return that actual address, with
no invented Canvas or Publish button. See [host-specific handoff](../SKILL.md#show-the-preview).

Later request: “Change the navigation and publish the update.” Keep `<PROJECT>`,
the source directory and access scope. After the changed output is validated,
use a new `<ACTION_B>` with **`prepare_site`**:

<!-- tool-input: prepare_site -->
```json
{"actionId":"<ACTION_B>","projectRoot":"<ROOT>","webDirectory":"dist","projectId":"<PROJECT>"}
```

Continue steps 3–6 using `<ACTION_B>`. If that update already has a matching
prepared action, resume its status instead of preparing again. For “show the
draft, do not publish,” follow the same readiness check but skip `publish_site`
and show the complete draft; keep the existing live version. Local-only work
uses the development preview and never starts this cloud workflow.

## First publication with a Function backend

Request: “Publish private notes with attachments.” This example assumes the
user's scope covers database, Functions and Storage, and the application's
identity and access requirements have been resolved. Use the existing
[Function backend example and SQL](../../sites-building/references/function-backend.md);
keep SQL outside the Function package. Existing projects start with their verified
IDs and skip bootstrap. Preserve an existing backend's model.

1. For a new site, prepare the completed frontend using step 2 above, but use
`<BOOTSTRAP_ACTION>` and a suitable name/slug. Keep its returned `<PROJECT>` and
`<SITE>`. Leave this initialization draft unpublished and do not show it as the
finished website. Read **`get_site`**:

<!-- tool-input: get_site -->
```json
{"siteId":"<SITE>","include":["backend"]}
```

2. For this authorized new allocation, **`ensure_backend`**:

<!-- tool-input: ensure_backend -->
```json
{"siteId":"<SITE>","requestId":"<ENSURE_REQUEST>","capabilities":["database","functions","storage"],"databaseAccessModel":"function_backend"}
```

Copy `operation.operation_id` as `<BACKEND_OP>`. Read **`get_operation`**:

<!-- tool-input: get_operation -->
```json
{"operationId":"<BACKEND_OP>"}
```

If nonterminal, retain this ID, pass the returned `next_after_sequence` as
`afterSequence` on the next read, and wait `retryAfterMs`. After success, re-read
`get_site` with `include: ["backend", "storage"]` to verify the requested
capabilities independently. A failed Operation stops this sequence.

3. **`get_database_schema`** for current structure and `<SCHEMA_BEFORE>`:

<!-- tool-input: get_database_schema -->
```json
{"siteId":"<SITE>"}
```

Inspect existing tables before choosing the SQL. For this new empty database,
read [schema.sql](../../sites-building/assets/function-backend/schema.sql) into
`<REVIEWED_SQL>`. **`create_database_migration`**:

<!-- tool-input: create_database_migration -->
```json
{"siteId":"<SITE>","requestId":"<PLAN_REQUEST>","clientMigrationId":"<CLIENT_MIGRATION>","displayName":"Create private notes and attachments","schemaRef":"<SCHEMA_BEFORE>","sql":"<REVIEWED_SQL>","accessPolicies":[]}
```

Review returned `migration.sql`, `migration.changes` and
`migration.access_policies`; retain `migration.migration_id` as `<MIGRATION>` and
`planRef` as `<PLAN_REF>`. When authorization covers that exact plan,
**`apply_database_migration`**:

<!-- tool-input: apply_database_migration -->
```json
{"migrationId":"<MIGRATION>","requestId":"<APPLY_REQUEST>","planRef":"<PLAN_REF>","confirm":true}
```

Follow its returned `<MIGRATION_OP>` with `get_operation` as in step 2. After
success, read `get_database_schema` again, verify the intended structure and
retain the new `schemaRef` as `<SCHEMA_AFTER>`. The original references and IDs
remain the recovery identity for their respective writes.

4. The frontend and Function are complete and validated. **`prepare_site`** now
uses a new action, the same Project and the verified schema dependency:

<!-- tool-input: prepare_site -->
```json
{"actionId":"<ACTION_A>","projectRoot":"<ROOT>","webDirectory":"dist","functionDirectory":"functions","projectId":"<PROJECT>","databaseAccess":"read_write","schemaRef":"<SCHEMA_AFTER>"}
```

Continue ordinary publication steps 3–6 for `<ACTION_A>`. Complete the requested
real notes/upload flow before final handoff; a ready backend or frozen static
preview does not establish application behavior. This example needs no ordinary
Secret values; applications that need them follow the supported Settings flow.

## Recovery card: Secret synchronization pending

The complete Function draft is already prepared. A cropped `get_publish_status`
result contains:

```json
{"actionId":"<ACTION_A>","artifactReady":true,"dependenciesReady":false,"canPublish":false,"published":false,"retryAfterMs":5000,"blockers":[{"kind":"secret","code":"sites_secret_not_ready","state":"sync_pending","name":"APP_API_KEY"}]}
```

Wait the actual returned interval, then **`get_publish_status`**:

<!-- tool-input: get_publish_status -->
```json
{"actionId":"<ACTION_A>"}
```

Retain the configured Secret and this action. Once the draft is ready, resume
publication from that result. A missing value and an inconclusive read are
different branches in [Recovery](deployment.md#recovery); synchronization pending
does not ask the user to enter the value again or create another draft.

## Recovery card: Publish response lost

`publish_site({actionId: "<ACTION_A>"})` timed out before its receipt arrived.
The call may have committed. Next call **`get_publish_status`**, not preparation:

<!-- tool-input: get_publish_status -->
```json
{"actionId":"<ACTION_A>"}
```

| Observed result | Continue with |
| --- | --- |
| `published: true` | Required integration checks, then show the same action. |
| `publishOperationId` and a pending Operation | Wait `retryAfterMs`, then read the same action. |
| No recorded publish Operation and the exact draft is still ready | Retry `publish_site` with `<ACTION_A>`; its private record retains the original request identity. |
| Operation failed/cancelled or a definitive conflict | Follow its actual error and [Recovery](deployment.md#recovery) before another write. |
| The status read also fails | Preserve the intent and restore reading first; report the unknown result accurately. |

Do not add a `requestId` to `publish_site`; its public input is only `actionId`.
Changing source, project or action is not recovery of this unknown result.

## Recovery card: Historical action is no longer current

Request: “What happened to yesterday's publication?” Its status includes:

```json
{"actionId":"<ACTION_A>","readiness":"publication_completed","published":false,"canPublish":false,"dependenciesReady":null,"operation":{"state":"succeeded","committed":true}}
```

Report that the action completed previously and the Site now uses another
publication. This is a status-only request; no preparation or publication follows.
Current dependencies were not rechecked.

If the user subsequently requests that content live again, verify its current
local source and target, then use the update input above with `<ACTION_B>` and
the same `<PROJECT>`. Reuse validated output only if unchanged. Repeating
`publish_site` on `<ACTION_A>` cannot make that completed action current.
For missing source, newer descriptors or a request merely to restore access,
follow [Historical publication](deployment.md#historical-publication) and
[Restore access](../../sites-management/SKILL.md#restore-access).
