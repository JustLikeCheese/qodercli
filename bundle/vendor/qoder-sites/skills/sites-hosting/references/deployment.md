# Qoder deployment

## Source, identity and artifacts

Use the current conversation directory returned by `get_context.local` or a selected site subdirectory inside it; a registered workspace is optional. Work in another project requires a task there; SSH/cloud publishing is not supported by these tools. Keep source and build output in that original project. Both hosts discover cloud-verified site descriptors. Preparation reuses the descriptor’s Project after validation; conflicting IDs or inaccessible targets fail without creating a replacement site. When switching hosts, prepare a new action from the local source; a descriptor does not transfer the original action’s recovery record. Reuse known IDs; use `list_sites` and `get_site` only when the target needs identification or fresh resource facts.

### Switching accounts in the same source directory

`get_context.local` returns the current account's cloud-verified bindings. Explain any `unavailableSites` to the user: an inaccessible entry does not mean no site exists. Continue an existing site under its original account, or, when the user explicitly requests a new site for the current account, call `prepare_site` with `createNewSite: true`, a new `actionId`, `displayName` and `slug`, and omit `projectId`. Keep the same source directory. Preserve the flag, action and inputs on retries.

A ready draft switches the single `.qoder.site` entry. The plugin retains private bindings per directory, account and environment; opening or continuing under the original account revalidates cloud access and restores its binding. Creation failure leaves the old entry intact. Legacy entries without private action records are backed up but cannot regain missing recovery records automatically; recover from the original host or prepare a new action against the verified existing Project. Account changes and lookup failures alone never authorize creating a replacement.

`prepare_site` packages and uploads an immutable snapshot. It generates the outer `sites.json`, ZIP and private recovery record; a ready preparation writes the project-local `.站点名称.qoder.site` descriptor without opening a preview. Inspect `descriptorStatus` and preserve the same action and inputs on pending or local-write failure. Retry the same preparation to recover the descriptor from its frozen ZIP without repackaging or uploading. Desktop's preview MCP also restores this descriptor when opening it. These are different artifacts, both tool-owned. Do not hand-write their fields, copy a descriptor as source recovery, or add a separate hosting manifest.

Source control is the user's workflow, not a prerequisite for this deployment API. No source repository credential, commit SHA, manual version save or direct private-deploy tool is required. The supported path is `prepare_site` → readiness checks → `publish_site` → verified status. CLI/Wake deliver its `site.url` directly; only Desktop calls the preview MCP after that. When publication is deferred, report the complete draft and stop before `publish_site`; Desktop may open the draft preview. Use `get_publish_status` for reads and recovery.

## Prepare inputs

Read the exposed tool schema before calling it. Use exact returned IDs and the current project's real paths:

| Input | Meaning |
| --- | --- |
| `actionId` | New UUID for a new frozen draft; retain for all retries of that exact intent |
| `createNewSite` | Optional explicit new-site intent for the current account; incompatible with `projectId`; preserve on retries |
| `projectRoot` | The absolute selected site directory within the `get_context.local` root; the host verifies the real path boundary |
| `webDirectory` | Relative, dedicated public output directory containing `index.html`; never the project root |
| `projectId` | Existing Project UUID for an update; omit only when intentionally creating a site |
| `displayName`, `slug` | New-site identity; choose a meaningful slug using the address rules below |
| `subdomain` | Optional explicit raw address prefix for a new site; omit for automatic slug-based allocation. Not accepted with `projectId` |
| `spa` | Whether the build needs the supported `index.html` fallback |
| `functionDirectory` | Optional relative directory with one `app` Function's `index.ts` and self-contained dependencies |
| `databaseAccess`, `schemaRef` | For a new draft, explicit `read_only`/`read_write` dependency and reference from get_database_schema for the same projectId; omit reference for `none`. Existing actions follow [Recovery](#recovery). |
| `secretNames` | Ordinary application Secret names used by the Function, never values or reserved platform names |

Use [Static output](../../sites-building/references/static-site.md) for path, routing and package limits, and [Functions and Secrets](../../sites-building/references/functions.md) for runtime requirements. The tool does not run application build commands, resolve arbitrary imports or apply migrations. Inspect public output for source maps, embedded configuration, real data and credentials before upload. Keep source control, dependencies, `.env`, private keys, symlinks and local fixture servers outside the package.

Request backend allocation only within the user's authorization. Preparation with a Function can allocate Functions; a database-dependent Function can request database and Functions but does not create the schema. Configure ordinary Secret values through Sites Settings after readiness, then verify synchronization for the dependent release. Secret names in the input are dependencies, not a way to provision their values.

For QCA, use [sites-build-agent-app](../../sites-build-agent-app/SKILL.md). The `qoder` capability includes Functions and provisions `QODER_PAT`; that reserved name is omitted from `secretNames`. The filtered Secret list cannot establish its presence or absence.

## Choose the first address

For a new site, choose one short, memorable lowercase slug from its purpose or title before the first `prepare_site`. Prefer two or three meaningful English words joined by hyphens, for example `daily-notes`, `team-weekly` or `studio-portfolio`. For a Chinese title, use a concise English rendering or readable pinyin. Use 3–51 characters, start and end with a letter or digit, and avoid reserved names and the `preview-`, `qoder-`, `qsites-` prefixes. Keep personal identifiers and private project details out of the public address. Reuse a suitable name the user supplied; ordinary naming does not need an extra question.

When the user has not required an exact prefix, pass the chosen `slug` and omit `subdomain`. AppHub tries that slug with the owner's fixed suffix and can allocate a random prefix if it is unavailable. When the user explicitly requests a particular prefix, pass it as `subdomain`; a rejected or occupied explicit name must be reported rather than silently replaced. The prefix is not a full hostname and never includes the owner's suffix. Creation does not require `check_subdomain`, which requires an existing Site ID.

After preparation, read the returned site's actual `host` and use that address in the draft summary and final handoff. Do not promise a predicted URL or add a separate rename just to replace a generated fallback. If preparation creates a bootstrap project, choose the name there and reuse the same Project/Site IDs for the complete draft. Preserve the original name and action through uncertain results; a new name cannot replace an unresolved create attempt.

For existing sites, reuse `projectId` and preserve the address. A user-requested address change follows [sites-management](../../sites-management/SKILL.md), with the server's edit fields and siteRef; publication alone does not authorize renaming.

## First publication with a database

For an existing project, reuse its IDs and begin with authorized database setup. For a new project, first build and review the actual frontend, then:

1. Prepare a static-only bootstrap draft with a new action, name and slug. Omit Function, database and Secret inputs. Retain the returned Project/Site IDs and leave this draft unpublished. Do not show its publication confirmation.
2. Read `get_site(include: ["backend"])`. For a new allocation, call `ensure_backend` with the authorized `database` and `functions` capabilities and `databaseAccessModel: function_backend`; include `storage` only for authorized file features. Preserve the reported model for an existing allocation. Wait for the Operation, then read `get_database_schema`. For `function_backend`, follow [Function backend](../../sites-building/references/function-backend.md), using `accessPolicies: []` and its business schema. Use the [legacy migration example](../../sites-building/references/database-migration.md) only for an existing legacy allocation. Configure ordinary Secrets through the supported input flow.
3. Prepare the complete website and Function with the existing `projectId`, a new action ID, explicit `databaseAccess` and the verified `schemaRef` for that project. Present only this complete action for publication.

`prepare_site` selects `function_backend` for a new database-dependent backend and preserves the model of an existing allocation. It freezes that selection before the ensure request for recovery. It does not migrate legacy allocations or apply SQL. For new apps expected to use data, provision database/functions together before a functions-only deployment; an existing legacy functions-only allocation cannot be converted in place.

Keep bootstrap and complete action IDs separate, including during recovery. Initialization must not create a second project or accidentally publish the bootstrap draft. QCA has its corresponding setup in [First-use initialization](../../sites-build-agent-app/references/initialization.md#prepare-the-site); combine capabilities only when the application requires them.

## Recovery

- If preparation is interrupted, retain the original action and inputs. `get_publish_status` requires a recorded deployment; when the first preparation stopped before that exists, resume `prepare_site` with the same action and exact inputs. The private record and request keys recover the operation.
- For an existing Function action on its original host, preserve the original `schemaRef` when available, or omit it to restore the frozen database dependency from the private action record. After a tool upgrade, also remove the obsolete `requiredSchemaVersion` argument. Keep every other input unchanged, including whether `projectId` was originally supplied. A fresh database read is for a new draft, not a replacement for the interrupted action's dependency. Missing trusted recovery data must be reported; it does not authorize a replacement action or site.
- When an explicitly created site's entry is pending, wait for readiness and retry `prepare_site` with the same action and exact inputs to restore the saved target replacement. Desktop may instead open its preview MCP when the trusted creation intent is recorded. A newer entry is never overwritten. Older private records without the saved creation intent require `prepare_site` with the original action and exact `createNewSite: true` inputs; do not infer permission from the descriptor or create another action.
- Unchanged source with a ready frozen draft does not need another build or upload. Changed content or preparation inputs require a new action; retain the existing `projectId`.
- A publish timeout or lost response is not proof of failure. Read the same action's status before deciding whether to retry. Never generate a new action/request ID just to bypass an unknown outcome.
- If that status read also fails, retain the original publication intent and restore read access first. When status shows an existing publish Operation, follow it without resubmitting. When it confirms no recorded publish Operation and the exact draft remains ready, retry `publish_site` with the same action; the private record preserves the request identity. A failed read never establishes that the write failed.
- An `unknown` dependency observation means its read was inconclusive. Retry the relevant read after access recovers; it does not establish missing schema or Secret values. For `sync_pending`, wait and check the same action. Only a confirmed missing Secret goes through Site Settings, and a confirmed schema gap goes through a reviewed migration.
- A conflict requires current status and the server's actual reason. Do not assume every `sites_conflict` is a slug collision or quota problem, silently replace the target project, or overwrite an expected version. Follow the existing intent's definitive outcome and the user's current delivery scope.
- Accepted, queued and running Operations are not completion. Stop polling a terminal result; report failure or the remaining blocker. Recovery must preserve the current live release and private records.
- `published` is true only when the publish Operation succeeded and committed, and its Release is the site's current published content. `canPublish`, upload acceptance and the Canvas preview are not interchangeable with that fact.

### Historical publication

`readiness: publication_completed` with `published: false` means this action's committed Release has been replaced. `canPublish: false` is expected; current dependencies are not rechecked. Repeating `publish_site` on this completed action returns its existing publication, rather than deploying it again.

For a status or historical-preview request, report that distinction and preserve the current live version. To make that content live again when the user requests it, verify the intended local source and target Project, reuse its validated output if unchanged, and prepare a new action for the same `projectId`. Follow current schema and dependency checks for the new action. This is a new publication, not rollback or recovery of the completed action. A frozen descriptor cannot recover missing source; preserve a newer directory entry and resolve its intended project before preparing.

## Schema changes while a version is live

Use expand-and-contract changes. Add compatible tables/optional columns first, keep the live Function working, and then publish the Function that uses them. Check live and new versions against the expanded schema. After the new version is verified and old callers no longer depend on the old fields, handle removals or permission tightening as a separate reviewed change.

Use a separately authorized process for data backfill; schema tools do not accept business DML. A failed publication does not authorize reversing a migration or deleting data. Preserve the compatible schema and live release while repairing the next draft.

If an old site has no descriptor, retry `prepare_site` on its original host with the known action and exact inputs to recreate the entry from the private record and frozen ZIP, without publishing. On Desktop its preview MCP can also restore the known action. If trusted recovery data is missing, do not fabricate a descriptor or create a replacement site: confirm the existing Project, then prepare current source under a new action. Preserve an existing newer entry.

For drafts, read artifactReady, dependenciesReady and blockers separately. canPublish is an observed preflight; AppHub performs final transactional validation. Missing Secret names are entered in Site Settings; Secret values stay in the supported settings input, outside CLI arguments and MCP output. Preserve the exact action for recovery.

Once publication commits, `get_publish_status` returns readiness=publication_completed, dependenciesReady=null and canPublish=false. Current dependencies are not rechecked. Check published and the current Site for publication status; use get_site details, get_database_schema and runtime tests to inspect live readiness.
