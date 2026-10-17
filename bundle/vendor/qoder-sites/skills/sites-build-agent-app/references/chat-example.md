# Runnable SSE chat example

Use [the chat example](../assets/sse-chat/web/index.html) when building a Managed chat UI or changing its streaming/recovery behavior. It provides a conversation list, message composer, incremental replies, stop, history reopening, responsive layout and light/dark themes. It reuses the existing `conversation-stream.mjs` and `sse.mjs` helpers through real HTTP streaming.

## Run locally

Use an installed Node 22 or newer; check `node --version` first and follow [Local tools](../../sites-building/references/environment.md#local-tools) if it is unavailable. No dependency install, build, PAT or cloud resources are required. From this skill's directory:

```sh
node assets/sse-chat/dev/server.mjs
```

Open `http://127.0.0.1:4318/`. An occupied port fails instead of attaching to another process; choose a different port with a command-scoped `PORT=4320` if needed. The runner binds only to `127.0.0.1`, checks Host and write Origin, and serves an explicit file allowlist.

The page clearly identifies **local controlled replies**. History lives in the server process's memory: browser reload and switching conversations retain it; restarting the runner clears it. Only the theme preference uses browser local storage. The local visitor is a fixture, not platform authentication. `dev/memory-service.mjs` is not a production coordinator.

Try one ordinary message, stop midway, switch to another conversation and reopen the first. Under **故障演练**, the next message can simulate a broken read, a generation failure, or an unknown send result. A broken read reconnects within a bounded budget; recovery reads existing state and never repeats the prompt POST. Unknown sends retain the original application request ID. This exercises local application behavior, not Cloud Agents availability, durable concurrency or deployed Function limits.

The first send and the New Conversation button share one creation in flight. JSON requests have a 20-second browser timeout; a timed-out write remains unknown, not rejected. If the creation response is lost, the initial input remains visible. **恢复状态** retries that same idempotent create command with its original request ID; it does not submit the message. Switching to an existing conversation remains available while a create is pending, and its late result cannot replace that view. Creation recovery and unknown message dispatch are separate: unknown message POSTs are never replayed.

## Reuse in a site

Keep the website's existing project and design. Copy only the pieces it needs; the standalone page is an optional complete UI example. To obtain a self-contained directory without development fixtures:

```sh
node assets/sse-chat/export-example.mjs "/absolute/path/to/new-chat-example"
```

The destination must not exist. The exporter produces:

```text
web/                         Static frontend and browser SSE helpers
functions/index.ts           Deno entry; deliberately returns 503 until configured
functions/sse-chat/          HTTP handler and Managed transport adapter
functions/cloud-agents.mjs   Server-only QCA client
functions/sse.mjs            Server-side SSE parser/encoder
```

The frontend has no build step. For an existing React/Vite site, adapt the page's state and controls into that app, copy the two browser helpers, preserve `/functions/v1/app/api/chat/...`, and use its normal build. Keep all server assets in the Function directory. The exporter excludes `dev/`; do not deploy the local runner, fixture identity or memory service. Preserve the existing site's other routes when composing handlers.

The exported Function intentionally calls `createChatHandler()` without a service and returns `chat_not_configured` (503). Publishing those bytes does **not** deliver working live AI. Supply a real application service, validate its Function entry using [Function checks](../../sites-building/references/environment.md#local-tools), then follow the normal backend, draft and hosting workflow. With Deno available, run `deno check --node-modules-dir=none functions/index.ts`. Keep `QODER_PAT` platform-managed and server-only.

## Connect a real conversation service

`handler.mjs` exports `createChatHandler({ service, streamLifetimeMs? })` and `ChatError`. Pass the application's service to that factory in the Function entry. The factory supplies bounded JSON input, public response projection, routes, SSE framing, a 45-second default read lifetime, keepalives and reader cleanup. Missing methods fail closed; there is no fallback to the local adapter.

| Exported service method | Required behavior |
| --- | --- |
| `authorize(request)` | Return `{ id }` from verified application identity; use the chosen backend's real identity adapter. Missing identity must raise `ChatError('login_required')`. |
| `info()` | Return `{ mode: 'live', persistence: '...' }`. Only `mode` reaches the browser; it is a display label, not proof of a storage guarantee. |
| `list(principal)` | Return at most 100 owner-authorized conversation snapshots. |
| `create(principal, { requestId })` | Idempotently create an application conversation and its durable intent; a reload must not allocate a new Cloud Session. |
| `get(principal, conversationId)` | Read the authorized snapshot and reconcile known/unknown dispatch state without resending the prompt. |
| `send(principal, conversationId, { requestId, text }, request)` | Enforce ownership/quota; persist request fingerprint and dispatch intent before a single upstream write; return a snapshot. Reuse the original request ID on duplicate input, reject changed input and preserve unknown outcomes. The local adapter alone reads `x-demo-scenario`; a live adapter ignores it. |
| `interrupt(principal, conversationId, { requestId, runId })` | Authorize and target this exact run using the current upstream interruption contract; reconcile uncertain results. Do not interrupt a newer run. |
| `watch(principal, conversationId, { signal })` | Return an async iterable of public snapshots. Register the reader before yielding the current snapshot, cover the history/live gap, keep revision monotonic, and release upstream work on abort or iterator return. |

Snapshots contain `{ id, title, revision, state, messages, runId?, requestId? }`. Messages contain `{ id, role: 'user' | 'assistant', text, state }`. States are `idle`, `running`, `pending`, `completed`, `failed` and `interrupted`. `requestId` is the application dispatch identity of the current run, not a Cloud event ID. Only a matching request ID proves that this send belongs to the displayed state. The handler validates bounds and excludes arbitrary provider fields.

The first stream frame is `ready`, carrying the current snapshot. It is a connection handshake even when that historical snapshot is completed. The UI waits for `ready` before POSTing a new message. Subsequent `snapshot` frames replace the same conversation's state; terminal states close the reader. The browser guards both history fetches and stream frames by active conversation/version, treats message text as text, and cancels the old reader on switch/unmount. A stream error or early EOF calls for read-side recovery, not another POST.

`managed-transport.mjs` exports `createManagedTransport({ origin, getToken?, fetchImpl?, ...clientOptions })` with concrete `send(sessionId, text)`, `history(sessionId, page?)` and `events(sessionId, { lastEventId?, signal? })` methods. These use the existing Managed API payload, pagination and SSE parser. Pass only a server-resolved `sess_*` binding; consume raw Cloud events inside the service, project permitted content, and persist canonical messages/cursors before publishing snapshots. The transport creates no resources and never retries writes. Follow [API integration](api.md) and [initialization](initialization.md) for trusted origin, resources and write recovery.

The example does not supply production conversation persistence, Session allocation, per-user quota enforcement or a distributed coordinator. The Function backend SDK's private credential and owner predicates are useful building blocks, but are not a transaction/fencing API. Establish the required durable/atomic provider operations before claiming concurrent or resumable live chat. If they are unavailable, keep live configuration disabled and report that dependency. Never copy the local Map implementation into deployment or infer exactly-once dispatch from a unique row alone.

## Verify the selected mode

Use the bundled page and its scenario selector to check ready-before-send, incremental output, stop, switch/reopen, failure and unknown-outcome recovery as described in [Run locally](#run-locally). Reuse the application's own checks when available. For changes to authorization or streaming, add focused checks for ownership rejection, missing production configuration and cleanup in the application project; the installed example does not require the Sites development repository or its test runner.

For live delivery, follow the skill's existing acceptance flow: verify a real browser → deployed Function → QCA conversation, and verify persisted history/ownership if those features are promised. The local demo is not evidence of live initialization, private provider ingress, multi-instance coordination or successful publication.
