# Create the notes schema and access policy

Read `get_site(include: ["backend"])` before selecting policies. For `function_backend`, use the schema and migration workflow in [Function backend](function-backend.md), with `accessPolicies: []`. The public-policy example below is only for existing `legacy` allocations.

Use this example with [legacy database access from Functions](database.md). Operate on the user's intended site and carry out cloud changes only within their authorization. For a new site, first follow [First publication with a database](../../sites-hosting/references/deployment.md#first-publication-with-a-database) to obtain its Project and Site IDs.

## Supported SQL

The migration API accepts a restricted subset of PostgreSQL, not arbitrary PostgreSQL DDL. Check the schema against these rules before creating a plan:

- Statements: `CREATE TABLE app.<table>`, `ALTER TABLE app.<table> ADD COLUMN`, and plain `CREATE INDEX ... ON app.<table> (<columns>)`. Custom PostgreSQL functions, triggers and arbitrary SQL/policies are unsupported.
- Column types: `boolean`, `integer`, `bigint`, `text`, `uuid`, `timestamptz`, `jsonb`. Arrays, `date`, `timestamp` without time zone, `numeric`, `varchar(n)` and other type modifiers are unsupported.
- Creation constraints include `NULL`, `NOT NULL`, `PRIMARY KEY`, `UNIQUE`, and restricted references within the app schema. Defaults support null, boolean, integer and text literals with matching column types and the fixed builtins `gen_random_uuid()` and `now()`; arbitrary expressions, `CHECK`, and generated/identity columns remain unsupported. Added columns must be nullable and have no defaults. AppHub validates the exact supported subset.
- Indexes: plain column names, without explicit `ASC`/`DESC`, NULLS ordering, expressions or predicates. Do not add schema-qualified index names.
- Supply values in the Function or use supported defaults on new tables. Keep seed data and all DML out of migration SQL; use declarative `accessPolicies` instead of raw GRANT or RLS statements.

| Application field | Supported representation |
| --- | --- |
| Calendar date | `text`, with validated `YYYY-MM-DD` values in the Function |
| Timestamp | `timestamptz`, with an explicit value from the Function |
| Tags or lists | `jsonb`, with array shape and item limits validated in the Function |

For example, these field and index definitions use the supported subset. They do not grant access:

```sql
CREATE TABLE app.entries (
  id uuid PRIMARY KEY,
  entry_date text NOT NULL,
  tags jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX entries_date_idx ON app.entries (entry_date);
```

## Change or revoke access policies without DDL

`accessPolicies` is the complete managed state of every touched table, so a plan can change policies with no schema change: an empty `sql` together with a non-empty `accessPolicies` list is a valid plan. Revoking every grant from one table uses the deny **table clear marker**:

```json
[ { "table": "notes", "principal": "none", "actions": [], "template": "deny" } ]
```

`deny` requires `principal: "none"`, an empty `actions` array and no `owner_column`; a previously granted principal such as `anonymous` is rejected. The marker enables row level security, revokes table privileges from `anon` and `authenticated`, and removes managed access policies while preserving the table and rows. It does not revoke privileged administrative access. Use it to revoke a table's managed grants without unrelated DDL; wait for the operation to succeed and verify the applied migration.

## Choose access before creating a plan

The public-notes example below is only for intentionally public records. For private diaries or other personal records, resolve a trusted application identity and enforceable owner policy before submitting or applying a migration. A private Site does not by itself supply that identity to the anonymous Function adapter. Do not convert a private-data design to `anonymous` + `public` CRUD as a production solution. If the runtime cannot enforce the required ownership, explain the missing capability and keep the private-data migration unapplied unless the user accepts the limited functional test described below.

A site-origin `/rest/v1` rejection proves only that route is closed; credentials absent from browser artifacts prove only that those artifacts do not expose them. Neither establishes provider-direct-access or alternate-ingress isolation.

For a limited functional test with unresolved isolation, describe the exact site, data to be stored, proposed grants and bypass uncertainty. Proceed only after the user explicitly accepts that scope, preserving the site's access mode and granting only the required actions. Record that acceptance against this specific site and grant scope. A request to build a private site, a reviewed schema, or an earlier site’s test approval does not establish it. Existing acceptance remains valid until scope changes. Include unresolved isolation in the final handoff even when login and persistence pass; do not silently replace the requested flow with fixtures. Without that acceptance, keep private-data grants unapplied. A test exception is not a production security guarantee.

## Create and apply the public-notes example

1. Read `get_database_schema` for the current structure and `schemaRef`. Refresh a stale catalog and wait for completion before continuing. Inspect the `notes` table if it already exists; adapt a new migration to its actual structure instead of recreating it.
2. For a new table, use this SQL with `create_database_migration`:

```sql
CREATE TABLE app.notes (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  created_at timestamptz NOT NULL
);
```

Supply this complete policy for the table:

```json
[
  { "table": "notes", "principal": "anonymous", "actions": ["select"], "template": "public" }
]
```

This explicitly makes every row in this example table anonymously readable. Use it only for public notes; do not put private records into this table. It grants no insert, update or delete access. The example starts empty; use local fixture records for preview. Do not add seed INSERTs to a schema migration or broaden public write access to populate the demo.

3. The tool input shape is below. Replace every placeholder with actual values; schemaRef comes from the database read, and the two IDs are new stable IDs for this exact plan:

```js
{
  siteId: actualSiteId,
  requestId: newRequestUuid,
  clientMigrationId: newMigrationUuid,
  displayName: 'Create public notes',
  sql: reviewedSqlAbove,
  schemaRef: databaseRead.schemaRef,
  accessPolicies: reviewedPoliciesAbove,
}
```

4. Inspect the returned `migration`, including normalized SQL, changes and access policies. Once authorization covers that exact plan, call `apply_database_migration`:

```js
{
  migrationId: migration.migration_id,
  requestId: newApplyRequestUuid,
  planRef: reviewedPlan.planRef,
  confirm: true,
}
```

Preserve schemaRef and planRef exactly with their request IDs on retry. Wait for the apply operation, read get_database_schema again and verify the affected columns and policies. Use the resulting schemaRef with the same projectId in prepare_site. Keep the original reference for recovery of an existing action; a changed dependency needs a new action.

Use the example Function with `databaseAccess: "read_only"`. Access-policy changes describe the complete managed state of every touched table; preserve the intended grants when extending the schema. Use [sites-management](../../sites-management/SKILL.md) for subsequent migrations.

## Rejected plans

`sites_migration_rejected` may include a fixed `validation_reason` and safe hint. `invalid_access_policy` identifies the policy list; `invalid_deny_policy` identifies an invalid deny marker. Correct those policies rather than changing SQL. DDL reasons include `unsupported_type`, `unsupported_type_option`, `unsupported_constraint`, `unsupported_index_option` and `unsupported_ddl`. Older servers also use `unsupported_ddl` for policy errors, so check both once when the diagnostic is generic. A definite rejection permits a new request ID for changed input; unknown outcomes still require recovery with the original identity.

When the server returns only the generic code, check the supported subset above once. If no concrete correction is apparent, report the unsupported construct or missing diagnostic instead of repeatedly creating probe plans. Preserve the intended access policy. Reuse a matching validated plan instead of creating the same plan again; only apply the final reviewed plan.
