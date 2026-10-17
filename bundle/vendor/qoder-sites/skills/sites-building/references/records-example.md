# Records and attachments workbench

Use this assembled example for a user-owned records application with supporting files. It reuses the React starter, existing Function backend routes and unchanged notes/attachments schema. It is an adaptable product example, not an additional platform service.

## Assemble and run locally

Select a compatible Node runtime using [Local tools](environment.md#local-tools). Run with the installed skill's absolute path and a new or empty project directory:

```sh
node "<sites-building-skill-root>/assets/function-backend/setup.mjs" "<project-root>"
```

The setup calls the bundled initializer, preserves an existing `.git`, and refuses a nonempty project. It neither installs dependencies nor creates cloud resources. For an existing application, integrate the relevant frontend and routes into its current structure instead of running setup over it.

In the assembled directory:

```sh
npm ci
npm run dev
```

Open the actual loopback URL. Local development serves the real [application routes](../assets/function-backend/routes.mjs) with credential-free memory DB, Storage and identity adapters from `dev/`. Its visible local notice links to `/__local/`, where account A/B, anonymous, empty list, failed read, lost create response, version conflict and lost upload-confirmation response can be selected. These controls are local fixtures, not deployed API capabilities. The next matching operation exercises the selected fault; no cloud request is made.

The frontend provides a responsive record list, filtering of the currently loaded latest 100 records, an inline edit panel, meaningful empty/error/loading states, and signed upload → transfer → confirmation → authorized download. Pending uploads remain visible for reconciliation. Existing schema has no original filename column; persistent attachments use short IDs and creation times. See the generated [README](../assets/function-backend/README.md) for the precise recovery and capacity limits.

## Build and publish

Run `npm run build`. Publish only `dist/` and `functions/`; `dev/`, schema and local fixture code stay outside both directories. Production frontend omits the local-mode banner and control link. The local runner's fake SDK does not establish provider atomicity, ingress closure or real account isolation.

Follow [Function backend](function-backend.md) and the [first-publication tool workflow](../../sites-hosting/references/workflow-examples.md#first-publication-with-a-function-backend) for authorized allocation, reviewed migration and delivery. This example uses database, Functions and Storage. Keep its actual schemaRef and `databaseAccess: read_write`; the site owner’s login and platform credentials are resolved by the deployed Function entry, never by the local test controls.

## Verify relevant behavior

- Create and edit a record; reload authoritative data and confirm it persists for the current local account.
- Choose a different record while attachment reads are in flight; results must remain with the selected record.
- Simulate a committed create with lost response, then explicitly recover; only one row should exist. Close/reload is outside the in-memory recovery guarantee.
- Simulate a conflicting or uncertain edit; read the current version before another save, preserving entered text.
- Upload a small supported file, confirm and download it; simulate a lost confirmation and reconcile the same attachment.
- Switch A/B and anonymous locally to exercise application ownership checks. Perform separate authorized real-account and provider acceptance before claiming production isolation.
