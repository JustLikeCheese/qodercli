# Cloud Agents API integration

This reference covers Managed chat. For WebSocket voice/text, use [Forward Realtime](realtime.md) with the same trusted API origin and server-only PAT boundary, but a separate resource/event contract. The Managed client's path allowlist intentionally excludes Forward endpoints.

Core requests checked on 2026-09-09; streaming contract rechecked on 2026-09-10. Re-read the relevant source when adding an optional feature or changing the request contract. The [overview](https://docs.qoder.com/zh/cloud-agents/overview) defines Agent, Environment, Session and Event; new accounts require an explicitly created Environment.

## Server connection

Use the trusted runtime configuration for the Cloud Agents HTTPS API origin and matching platform authentication. The public documentation's example origin is not a fallback for missing configuration. Desktop Sites management uses its own JobToken/OpenAPI route; it is separate from the PAT-authenticated Cloud Agents API. If the target origin cannot be verified, leave live integration pending. Keep the chosen origin in server configuration. The Function sends `Authorization: Bearer <QODER_PAT>` using its runtime Secret directly to the Cloud Agents API. See [Authentication](https://docs.qoder.com/zh/cloud-agents/api/conventions/authentication).

Obtain the origin through `sites.get_context` with empty arguments and copy `runtime.cloudAgents.apiOrigin` exactly into trusted server configuration. `sitesOpenApiOrigin` is a separate management endpoint. Never replace an unconfigured origin with that value or the public documentation example. The mapping is maintained in Sites code, not duplicated in this skill. Use the returned mapping exactly, even when the hostname appears to suggest a different environment; do not infer or display environment labels from it. Private deployments without a Cloud Agents mapping return `configured: false`.

The bundled `createCloudAgentsClient({ origin })` reads the current Secret for every request, rejects redirects, bounds JSON response size and request duration, and returns safe error codes. Copy `assets/cloud-agents.mjs` into the Function directory and import it relatively. Business code should expose only the required app operations, not the client's generic request function. For a TypeScript Function, follow [Function checks](../../sites-building/references/environment.md#local-tools) before preparing the draft. With Deno available, run `deno check --node-modules-dir=none functions/index.ts` from the website project; the bundled JavaScript client includes parameter types for TypeScript callers.

## Requests used by the workflow

| Operation | API and essential input | Official source |
| --- | --- | --- |
| Discover models | `GET /api/v1/cloud/models`; select an enabled returned `id` and keep the selection stable | [Models](https://docs.qoder.com/zh/cloud-agents/api/models/list) |
| Define Agent | `POST /api/v1/cloud/agents` with `name`, `model`, optional `system`, `tools`, `metadata`; preserve an `Idempotency-Key` for this exact definition | [Create Agent](https://docs.qoder.com/zh/cloud-agents/api/agents/create) |
| Define Environment | `POST /api/v1/cloud/environments` with `name`, `config: { type: 'cloud' }`, application metadata | [Create Environment](https://docs.qoder.com/zh/cloud-agents/api/environments/create) |
| Start conversation | `POST /api/v1/cloud/sessions` with `agent` and `environment_id`; optionally pin the Agent version | [Create Session](https://docs.qoder.com/zh/cloud-agents/api/sessions/create) |
| Send prompt | `POST /api/v1/cloud/sessions/{id}/events` with an `events` array of content-block messages | [Send Events](https://docs.qoder.com/zh/cloud-agents/api/sessions/send-event) |
| Read progress | `GET /api/v1/cloud/sessions/{id}/events?order=asc&limit=100`; use returned cursors | [List Events](https://docs.qoder.com/zh/cloud-agents/api/sessions/list-events) |
| Stream progress | `GET /api/v1/cloud/sessions/{id}/events/stream`; Function attaches authentication and reconnect cursor | [Stream Events](https://docs.qoder.com/zh/cloud-agents/api/sessions/stream-events) |

Minimal message input:

```js
{
  events: [{ type: 'user.message', content: [{ type: 'text', text: validatedPrompt }] }],
}
```

Creation responses are resource objects with `id`; list responses contain `data`, `has_more`, and `next_page`. Follow all required pages when matching stored resource metadata. Keep a bounded request budget; an incomplete scan is not proof that a resource is absent.

Do not assume every POST supports the Agent endpoint's idempotency contract. Environment/Session creation and message delivery use the durable intent and reconciliation workflow in [Initialization](initialization.md). A 409 when sending while a Session is running means the message was not queued; wait for idle or perform an explicitly authorized interruption. A timeout or 5xx does not establish that a write was rejected.

## Function endpoints and state

Application paths are chosen by the website, for example query actions on `/functions/v1/app?action=ai-start`, `ai-message`, and `ai-events`. These are application routes, not Cloud Agents API paths. Keep browser inputs to prompt text, an application conversation identifier, and a request identifier. Resolve the upstream Session ID on the server after checking ownership. Never accept arbitrary URLs, PATs, Agent configurations, setup scripts or tool definitions from a public request.

Do not share a Cloud Session or writable Environment between unrelated website users. A stateless, no-user-data Environment template may be reused if the chosen Cloud contract gives each Session an isolated runtime; keep user-specific setup, files and state bound to that user/session. Persist Agent version and environment configuration revision for continuing conversations, instead of silently migrating them to a new definition.

Agent API acceptance is asynchronous work, not the final result. Preserve message intent and returned event IDs. Use `Accept: application/json` for history reconciliation, paginate and deduplicate by Event ID; use SSE deltas for interactive chat updates. Only publish the app's selected message/status content; do not relay raw prompts, tool arguments, internal thinking, credentials or account metadata. Display tool confirmation as an explicit app interaction only when the application implements the authorization and result path; do not automatically approve tool actions.

## Streaming and reconnection

For chat transport, read [Streaming](streaming.md). The client asset exposes `openStream(sessionId, { lastEventId, signal })` returning `{ body, close }`; it authenticates against the configured origin and requests `event_deltas[]=agent.message`. Its short timeout covers response headers only. The application owns stream lifetime, authorization, persistence and public-event projection. Parse the body with [sse.mjs](../assets/sse.mjs); close the upstream handle in `finally`.

For failed requests and application usage counts, read [Runtime diagnosis](diagnostics.md). The JSON client emits safe failure diagnostics; the HTTP handler may return only the random `diagnosticId` alongside its existing public error. This correlation field does not authorize relaying the raw error or upstream response.
