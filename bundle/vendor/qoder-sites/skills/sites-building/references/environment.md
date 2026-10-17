# Qoder environment

## Project and source

Use the current task's original local project. Preserve its instructions, package manager, lockfile, source layout and installed components. For a new simple static site, create a dedicated public directory such as `web/` or `dist/`; a framework is optional. Existing applications keep their own setup and build scripts.

For a new React application in an empty project, use the bundled [React starter](../templates/react-starter/README.md). Run `node "<sites-building-skill-root>/scripts/create-site.mjs" "<project-root>"` with the real installed skill and current project paths. The initializer checks the starter's supported Node versions before copying and refuses to overwrite existing project files. The starter includes a typed UI catalog, static build and optional local Function proxy, but does not allocate cloud resources.

Run `npm ci` from the new project root, then `npm run dev` after installation succeeds. While installation runs, author independent page and style changes without modifying dependency inputs. Use one installer at a time and reuse the installed dependencies while the manifest and lockfile remain unchanged. Existing applications use their own package manager and scripts; plain static sites need no installation.

Before cloud preparation, use `get_context.local` to read the current conversation directory. Both registered workspaces and standalone local conversations are supported. Build and prepare inside that directory; the host verifies it. Remote sessions are unsupported. To work elsewhere, open a conversation there and reuse the existing site IDs.

The generated `.站点名称.qoder.site` is a publication-preview descriptor, not editable hosting configuration or a source repository. It points to a prepared action and cannot recover missing source on another machine. Use the tools to write or refresh it. Reuse Project/Site/action IDs from the current task and tool results; if the intended site is ambiguous, resolve it with `list_sites` and `get_site` before writing.

## Local tools

Check only tools needed for the selected workflow, using their version command before first use. Resolve assets from the installed skill directory and browser/image tools from the current tool catalog. A development checkout, personal utility, or a plugin's private runtime is not assumed to be available on the task's PATH.

- **Node/npm:** Existing projects keep their own engine requirement. For a new React project, use the starter's [package.json](../templates/react-starter/package.json) and bundled version check. Select an already installed compatible runtime through the environment's available version manager or its verified executable path. Keep that runtime selected for install, dev and build in subsequent commands; do not change global shell profiles. Plain static files need no Node installation.
- **Static preview:** Prefer the project's existing preview command or an available host preview. The [Python server example](static-site.md#local-preview-and-acceptance) is an optional fallback. If no server is available, finish file/build checks and independent work; report local preview as unavailable. A local-only delivery still needs a usable preview before claiming it complete.
- **Function checks:** Use the project's existing check when it validates the same Edge Function entry and imports. Otherwise check `deno --version` before `deno check` or local Deno execution. If Deno is unavailable, continue frontend work and credential-free handler checks on an available runtime; keep Deno-specific validation pending until a compatible local runtime or an existing CI check can run it. Frontend TypeScript checks and Node fixtures do not prove Deno compatibility.
- **HTTPS examples:** Reuse a suitable local certificate and key. Certificate generation requires an available tool; follow the [HTTPS example](../assets/application-auth/README.md#local-https) for alternatives. Keep certificate files outside upload roots.

Use the environment's normal dependency setup when a required tool is missing. Record the exact missing tool and affected check if setup is unavailable; tool absence does not justify changing the requested feature, weakening TLS/authentication, or reporting a check as passed. HTTP probes can use the available request tool, Node `fetch`, or `curl`; no particular HTTP CLI is required.

## Runtime and output

| Concern | Qoder Sites implementation |
| --- | --- |
| Website | Static files with `index.html` in the selected `webDirectory` |
| SPA | `prepare_site.spa`; use the current routing contract in [Static output](static-site.md) |
| Server code | One `app` Edge Function from `functionDirectory/index.ts`; HTTP handler with self-contained imports |
| Browser-to-server calls | Same-origin `/functions/v1/app`, including supported subpaths/query actions |
| Database | Function-side Supabase adapter, reviewed schema/access policies and explicit runtime dependency |
| Files | Platform Storage through the injected Function SDK; owner file tools are separate administration |
| AI | [sites-build-agent-app](../../sites-build-agent-app/SKILL.md), using the `qoder` backend and server-only `QODER_PAT` |
| Draft and release | `prepare_site`, `get_publish_status`, `publish_site`; Desktop preview uses its MCP only |

Use [Functions and Secrets](functions.md) before server implementation. Do not assume a Node server, framework SSR process, Cloudflare Worker binding or deployment-time package installation is available. The packager does not compile application source or resolve missing dependencies. Framework applications must produce compatible static output and put required server behavior behind the Function.

Qoder supplies the current account and management authentication. Use the available `sites` tools, not a new management HTTP client or user-pasted PAT. Ordinary application Secret values are entered through Sites Settings; only names enter preparation inputs. Reserved platform Secrets remain inside their supported runtime boundaries.

## Local preview and testing

When needed for a supported preview or local validation, start the project's existing development or preview command in a retained process, bound to loopback. For plain static files, use the local server example in [Static output](static-site.md). For Functions, use the same-origin development proxy and local handler setup in [Functions and Secrets](functions.md). Keep local fixture servers outside both output directories.

Read the server's actual URL and make a lightweight request to confirm the route serves successfully. A response check proves availability, not visual or functional correctness. Fix compilation or blocking runtime errors before presenting the first meaningful preview.

For a foreground task, inspect the available user-facing preview tool's current schema. If it supports this local URL, show the [first meaningful preview](../SKILL.md#first-meaningful-preview) and retain the returned view identity for later updates. Reuse the same view and server rather than opening another development window. No particular browser or preview API is assumed. Without a supported tool, continue implementation; provide the verified URL for local-only work or an explicit request to see development progress. Hosted work finishes with the publication preview described below. Browser QA follows the [validation scope](../SKILL.md#validation-scope), independently of opening a preview.

Keep the server available while the user is reviewing or continuing local work. Record the PID and working directory of each server you start. Stop only that verified task-owned process when no longer needed; choose another free port when occupied. Do not kill processes by port, broad name patterns or unverified PID lists, even to recover a failed preview. Background work can skip a user-facing preview and still validate the output.

## Hosted delivery

Read [sites-hosting](../../sites-hosting/SKILL.md) after the requested website is complete and locally validated. That skill owns publication, draft recovery and preview handoff, including explicit requests to defer publication. `prepare_site` can create a project, allocate requested backend capabilities and upload artifacts; it is not a local preview command. Source commits, pushes and manually assembled outer manifests/archives are not publication prerequisites.

On Desktop, the Canvas preview renders the exact frozen static package. CLI returns the published site link or a deferred draft summary and does not open a Canvas. The preview does not execute Functions, supply website credentials or prove backend behavior. The final release and its access policy remain server-owned. Follow `sites-hosting` to publish by default and then show the preview; audience changes retain their separate authorization requirements.


Desktop `get_context.local` discovers `.qoder.site` files under the current workspace. Choose the intended site directory before preparation. Keep one site file per directory; multiple sites in one workspace use separate subdirectories. Preparation automatically reuses the current account’s verified directory binding. For an explicit request to create a new site for another account in the same source directory, follow [account switching](../../sites-hosting/references/deployment.md#switching-accounts-in-the-same-source-directory). Do not copy or edit a site file to create another site or change its publication identity. The file embeds the frozen homepage; original source and build output remain in the project.
