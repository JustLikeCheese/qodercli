---
name: sites-management
description: "Manage existing Qoder Sites: restore access, sharing and visitors, names and addresses, deletion, backend capabilities, database schema and records, Storage files, Secret metadata/removal, Function diagnostics and analytics. Use sites-building for application code and sites-hosting for publication."
---

# Manage a Qoder Site

Base directory for this skill: `${QODER_PLUGIN_ROOT}/skills/sites-management`. Resolve relative links and resource paths from this directory; links inside a reference document are relative to that document.

Run Sites through the Bash tool with the exact host command below. Windows requires Git Bash; PowerShell-only sessions are not supported:

```text
${SITES_COMMAND} <operation> --input '<JSON>'
```

For JSON containing quotes, multiline text or shell metacharacters, write a UTF-8 JSON file inside the current project with the file tool, then use `--input-file <path>` instead of inline `--input`. Run one Sites command per shell call; do not use pipes, command substitution or a heredoc.

Run the exact command directly as one foreground shell invocation, keeping its session argument. The host supplies the current credential; never read or pass credentials manually.

In examples, `sites` means this full command, including `--session`. Discover operations with `sites list` and inputs with `sites describe <operation>`. SessionStart must have created the context; if it is missing, report the failure and restart the host session. If the host shell tool is unavailable, report that Sites execution is unavailable in this host. Use the CLI for all 32 business operations. On Desktop, use the `qoder_sites` MCP `show_publish_confirmation` only to open the frozen preview after checking publication status. Native CLI/Wake return the verified result directly.

When `get_context.runtime.host.secretValueInput` is false, this host has no Secret value editor. Existing Secret metadata and explicitly authorized removal remain available. Report missing or unsynced Secrets as blockers; do not direct users to a nonexistent host Settings page, accept secret values in chat, or substitute the host login token.

Use the available `sites` tools with host-issued account, environment and authentication. AppHub authorizes every resource. Keep management within these tools; credentials, provider tenants, buckets and arbitrary HTTP targets are not tool inputs.

## Identify the target and intent

Reuse the verified Site ID from the current task and read only the facts needed for the requested operation. If the target is unknown, use `list_sites` with `scope: owned` (default), then `get_site` to identify it. `scope: shared` lists sites shared with the current account; visitor access does not grant management rights. Preserve Project and Site IDs.

Read-only inspection can proceed immediately. Perform writes covered by the user's request; clarify only when the resource or consequential change is unclear. Inspection alone does not authorize allocation, schema application, overwrites or removals. Describe behavior, results and remaining blockers in plain language.

Reads return opaque references: `siteRef`, `accessRef`, `backendRef`, `secretRef`, `schemaRef` or `planRef`. Copy the appropriate reference unchanged with a stable UUID `requestId` for each new write intent. Keep both and all parameters on an unknown outcome. References bind the original read to this account, environment and resource, survive a plugin restart, and do not grant authorization. A conflict requires reading current state and reviewing the changed intent; never refresh a reference simply to force a write through. A lost reference after an unknown write requires diagnosis, not a new intent.

## Restore access

Read `get_site` and check the target, `lifecycle`, `hasPublishedContent` and `access_mode`. If already active, report its state. If it has no published content, use [sites-hosting](../sites-hosting/SKILL.md). Resolve “重新发布” against the request: restoring access uses `resume_site`; delivering changed source uses publication.

For an authorized restore, call `resume_site` with `siteId`, `siteRef`, stable `requestId` and `confirm: true`. An explicit restore request supplies authorization; no repeated confirmation is needed. The tool preserves the audience and published content and returns a synchronous site. Verify `lifecycle: active`; a replay can return a site paused again by a subsequent action. Report governance or lifecycle blockers accurately. Restoring access does not prove runtime database or Function behavior.

## Sharing and site settings

Read `get_site_access` for policy, `available_modes`, limits and visitors. Follow `pages.next_page` with the same `accessRef`; conflicting pages require restarting inspection.

- `update_access_policy` takes the reviewed `accessRef` and a returned mode. Public sharing requires authorization covering public access and `confirmPublic: true`.
- `put_access_target` takes a full email or case-sensitive Qoder UID in `email`; `remove_access_target` takes the returned `targetId`. Both use `accessRef`. Visitors are distinct from project managers. Read back after a change.
- `update_site` accepts `siteRef` and exactly one of `displayName` or `subdomain`. For address edits, use `subdomain_prefix` and the fixed `subdomain_suffix` where available; keep `host` as the current address. If absent, request a new raw prefix rather than inferring one. Explain that the URL changes and old links stop working. Check the raw prefix with `check_subdomain`, then submit the same prefix; availability is not a reservation and `normalized_subdomain` is not an editable prefix.
- `delete_project` takes `siteId`, `siteRef`, the exact project display name as `confirmDisplayName` and `confirm: true`. Explain resource/data removal first. Poll its operation and verify final state; blocking dependencies require a separate decision.

## Status and diagnostics

`get_site` returns current site/project facts and backend summary by default. Select `include: ["backend", "functions", "secrets", "storage"]` only as needed; `include: []` reads site/project alone. Requested detail failures remain errors, not empty results.

`get_publish_status` reads a known local preparation's `actionId`. Without a local action, inspect `get_site`; do not prepare a draft merely to query status. `get_operation` includes safe progress codes, `next_after_sequence`, `terminal` and `retryAfterMs`. Reuse the operation ID and cursor; accepted, queued and running are not completion. After completion check the affected resource and runtime behavior.

Reuse a fresh read for the next dependent step; read again after a wait, relevant change or uncertain result. An unknown dependency read does not prove that configuration is missing. Follow [publication recovery](../sites-hosting/references/deployment.md#recovery) for pending, failed or historical actions. Service limits follow [limit messages](../sites-hosting/references/limits.md); preserve the blocked intent and avoid repeated writes or quota workarounds.

Use `get_function_logs` for request diagnostics (`type: requests`) or output (`type: output`). Follow [data and log query rules](references/data-and-logs.md#diagnose-function-requests-and-output) for fixed-window pagination, allowed filters and untrusted content.

## Backend capabilities and Secrets

Read `get_site` backend details, then use `ensure_backend` for authorized capabilities: database, functions, storage or qoder. This can allocate cloud resources. New database allocations use `databaseAccessModel: function_backend` with database/functions; preserve the model of existing allocations. Poll the operation and independently verify each requested capability.

For a new site's database setup spanning bootstrap, migration and first release, use the [Function-backend workflow example](../sites-hosting/references/workflow-examples.md#first-publication-with-a-function-backend); reuse its returned Project and references rather than initializing a second site.

For Cloud Agents, complete the [Qoder PAT disclosure and explicit confirmation](../sites-build-agent-app/SKILL.md#3-prepare-the-sites-ai-capability) before requesting qoder. Reuse a ready capability; verify it in backend details. Its platform-managed `QODER_PAT` is omitted from application Secret metadata and ordinary Secret writes.

Use `get_site(include: ["secrets"])` for application Secret names and synchronization, and functions details for dependencies. Values are entered in supported Site Settings; CLI has no Secret-value input tool. For authorized removal, `delete_secret` takes the exact name and its `secretRef`, stable requestId and `confirm: true`. Explain the effect on dependent Functions, poll the operation and read metadata again. Reserved names remain unavailable.

Use `release_backend` only for explicitly requested release after explaining data impact. Copy `backendRef` from backend details and set `confirm: true`. Nonempty Storage or dependency rejection does not authorize deleting those dependencies.

## Database structure and application data

Read [the supported SQL and policy workflow](../sites-building/references/database-migration.md) before creating migration SQL. For an existing live site, follow [compatible schema changes](../sites-hosting/references/deployment.md#schema-changes-while-a-version-is-live).

1. Read `get_database_schema`. Disabled means the database is not enabled. For a stale enabled catalog, use the same tool with `refresh: true` and a stable requestId, then poll its operation before reading again.
2. Read table summaries or specify `tableName` for structure. Preserve `schemaRef` for pagination and dependent calls. A conflict requires restarting inspection. These reads return no business rows or credentials.
3. Create a plan with `create_database_migration`, `schemaRef`, stable client migration ID, display name and restricted SQL. For function_backend, omit accessPolicies or pass []; legacy policies describe the complete managed state of each touched table. Keep DML, credentials and business records out of migrations.
4. Review the returned changes, SQL and access policies. Creating a plan does not apply it. Recover a specific plan with `get_database_migration`; request includeSql only when needed.
5. When authorization covers the exact plan, apply its migrationId and `planRef` with a stable requestId and confirm=true. Poll the operation and inspect the resulting structure. Re-read `get_database_schema` for a new `schemaRef` after a successful change.

For a database-dependent Function, `prepare_site` takes databaseAccess, projectId and the verified `schemaRef`. The plugin binds the dependency internally; these declarations do not themselves grant runtime permissions. Keep the original reference when recovering the same preparation.

### Viewing stored records

Use `query_database_rows` and the distinct insert/update/delete tools for authorized business records. Follow [Owner data and Function diagnostics](references/data-and-logs.md) for typed values, complete primary keys, pagination and synchronous receipts. Owner access is separate from visitor permissions; keep visitor business requests in authorized Functions. The current Desktop has no row browser; do not invent a Database panel or publish an endpoint just for Owner inspection.

## Storage and analytics

Read `get_site(include: ["storage"])` for readiness, file limits and management_available. Proceed only when management is available. Storage is one platform-managed private bucket per site.

- `list_storage_objects`: omit prefix or use an empty string for the root. One optional trailing slash is accepted. Follow next_offset while has_more is true; native pagination can change during writes. Folder entries can be listed, not downloaded. Paths reject traversal, repeated slashes, reserved URL/control characters and non-NFC Unicode.
- `upload_storage_file`: use `get_context.local.projectRoot` and an authorized relative regular file inside it, exact objectPath, contentType and stable requestId. Maximum 10 MiB and the site's stricter policy apply. Overwrites require authorization, upsert=true and confirmOverwrite=true.
- `download_storage_file`: write a new relative file inside the conversation directory; parent directories must exist. Existing files are never overwritten.
- `delete_storage_object`: delete one exact object after explicit authorization, with confirm=true and stable requestId. No recursive deletion or file CAS is promised. Unknown receipts require inspection before deciding on a retry.

File content does not appear in command output. Local path checks, hash validation and account isolation remain enforced.

Use `get_analytics` with window 24h/7d/30d and metric pv/uv. Use the server total, especially for estimated UV; never sum unique visitors across buckets. Preserve coverage, reasons and unavailable values; absent data is not zero. Verify final state and requested runtime behavior before reporting completion.
