# Static output and routing

## Project and build

Directory names below are examples; retain the user's layout where appropriate. Output paths passed to the tool must be relative to `projectRoot`.

```text
my-site/                  # Registered local project root
  src/                    # Optional framework source
  dist/                   # webDirectory; only artifacts intended for publication
    index.html
    assets/...
  functions/              # Optional functionDirectory; keep outside dist
    index.ts
    shared/...
```

Plain HTML projects may use a separate `web/` output directory. Framework projects should run their production build and use its actual output directory; a working development server does not prove production artifacts are complete. Produce a static export that covers the required page behavior and use Edge Functions for server logic.

## Browser paths

Sites are hosted at the domain root, so asset links should target that root. Application Functions use `/functions/v1/app`. Derive the domain from the current page; keep test domains, private addresses, and local ports out of production scripts.

| Site type | `prepare_site` options and behavior | Required checks |
| --- | --- | --- |
| Standard static site | `spa: false` (default); no HTML error fallback configured | Home page, existing `.html` links, missing paths |
| SPA | `spa: true`; generates an `index.html` error fallback with status 200 | Direct navigation and refresh on deep paths; asset response content types and bodies |
| Directory-based multipage site | The current plugin always disables directory indexes | Use actual file links such as `/guide/index.html`; do not assume `/guide/` resolves to an index |

SPA fallback can return HTML for a missing script. Inspect response bodies when debugging; HTTP 200 alone does not prove an asset loaded correctly. Keep application routes and static assets outside platform namespaces: `/api`, `/internal`, `/__qoder_auth`, `/__qoder_internal`, `/functions`, `/storage`, `/rest/v1`, and `/supabase`. `/api` is not this platform's default application function entry point.

Call Functions with same-origin relative URLs. Do not download runtime credentials or physical routing configuration into the browser. Cross-origin access to other public external APIs depends on their actual contracts; changing Sites code does not imply that access is allowed.

## Packaging requirements

`prepare_site` generates `sites.json`, `web/`, and optionally `runtime/app.zip`. The source project does not need a manually written outer manifest or ZIP. Tool parameters do not execute build commands, arbitrary rewrites, or SQL.

- The output directory must be inside the current local conversation directory and must differ from the project root.
- Use canonical relative file paths and UTF-8 NFC. Case collisions, symlinks, dot segments, encoded paths, and control characters are rejected.
- Exclude `.git`, `node_modules`, `.env*`, SSH/private-key files, and the platform-reserved `_qoder` directory. Put application-owned function modules in ordinary directories such as `shared/`.
- Current local packager limits: 10,000 files per directory scan, 50 MiB per file, 450 MiB of raw Web content, and 50 MiB of raw Function content. Locally generated ZIPs are limited to 100 MiB, but the current Worker has a stricter 50 MiB artifact limit. Keep deliverables within 50 MiB. The server independently validates expanded size, compression ratio, and current quotas; passing local checks does not guarantee acceptance.
- Inspect public configuration, source maps, embedded data, and third-party scripts. Built-in scanning detects only some sensitive patterns.

## Local preview and acceptance

For static output, prefer an existing project preview command or an available host preview. A Python server is an optional fallback: first verify `python3 --version` reports Python 3, then run from the project root:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

On Windows, `py -3` can replace `python3` when `py -3 --version` succeeds; another verified Python 3 executable works too. If Python is absent, use an already available static server instead. If none is available, follow [Local tools](environment.md#local-tools) and report preview as pending without treating file checks as browser verification.

Wait for `http://127.0.0.1:4173/` to respond. If a different port is used, use the actual URL from the server output. Follow the local validation and handoff steps in [sites-building](../SKILL.md). For SPAs, use the project's existing build-preview server with fallback routing; for Functions, configure the local same-origin proxy described in [Functions and Secrets](functions.md).

Before publication, distinguish output/build checks from any interaction checks actually performed. Follow `sites-hosting` to verify committed status; separately check the deployed URL when reachability testing is requested. Local preview, successful cloud publication, and visitor access are separate validation results. Keep clients compatible with adjacent Function releases because older pages may remain open.
