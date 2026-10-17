# QCA Forward Realtime

Use for realtime voice, text-to-audio, live captions and duplex interaction. Contract checked on 2026-09-23: [create conversation](https://docs.qoder.com/cloud-agents/api/forward/realtime/create-conversation), [connect and events](https://docs.qoder.com/cloud-agents/api/forward/realtime/connect). The API is beta; recheck the relevant contract when extending it.

```text
Browser ── same-origin WebSocket ── Sites Function ── authenticated WSS ── QCA
                                      QODER_PAT
```

Use `runtime.cloudAgents.apiOrigin` from `get_context` exactly as described in [Server connection](../SKILL.md#2-establish-the-server-connection). Derive WSS by changing that origin's scheme to `wss:`. The Function's platform `QODER_PAT` authenticates QCA directly; Sites management JobTokens and browser login cookies are separate credentials. QCA requires an `Authorization` handshake header, which native browser WebSocket cannot set. The server adapter must support it; local Deno support does not establish that the deployed Edge runtime supports the same constructor options.

## Conversation creation and ownership

Reuse an accessible, enabled Forward Identity and an accessible Template configured with the required model/environment/tools. Managed `agent_*`/`sess_*` resources are not Forward `tmpl_*`/`conv_*` resources. Keep all those selections server-owned. Use the current Forward resource APIs if new Identity/Template resources are authorized; the bundled Managed bootstrap helper does not create them.

On an authorized application start POST, persist an intent containing the site/user binding, application conversation ID, exact body and a stable UUID idempotency key. Then issue one bounded server request:

```http
POST /api/v1/forward/realtime/conversations
Authorization: Bearer <server QODER_PAT>
Content-Type: application/json
Idempotency-Key: <persisted creation UUID>

{"identity_id":"idn_...","template_id":"tmpl_...","title":"Voice conversation"}
```

The optional `config.audio.output.voice` selects a documented preset at creation. Persist the returned `conv_*` ID and require `status: "ready"` before connecting. Reconcile a timeout with the same key and body; `409 idempotency_key_in_progress` uses `Retry-After`, while `idempotency_conflict` requires resolving the changed intent. Never mint a new key just because the first response was lost. Page loads and WebSocket reconnects only resolve existing bindings.

Resolve each browser application ID against the current verified site/user before opening QCA. For new multi-user/resumable apps use [Function backend](../../sites-building/references/function-backend.md); for existing legacy allocations use [legacy identity and coordination](../../sites-building/references/database.md#identity-and-coordination). Neither adapter supplies a conversation service or distributed coordinator; apply the [durable-intent requirements](initialization.md#resource-scopes-and-durable-intents) to this Forward workflow. `conv_*` alone is not authorization, and a shared owner PAT does not isolate website users. Session history, concurrency policy and creation idempotency remain application responsibilities.

## Adapt the demo

Start with [the transport demo](websocket.md#run-the-credential-free-demo). Keep its relative module layout inside the Function. For QCA, configure `createRealtimeDemoHandler` with:

| Option | Source |
| --- | --- |
| `siteOrigin` | Exact trusted public origin of this site; used for Origin checks |
| `apiOrigin` | Host-issued `runtime.cloudAgents.apiOrigin`, server-only |
| `resolveConversation(request, applicationId)` | Required application adapter: verify identity, ownership, quotas and return the stored `conv_*`; return `null` to deny |
| `connect(url, { headers })` | Server runtime WebSocket adapter; default uses Deno's `new WebSocket(url, { headers })` extension |

`resolveConversation` is an application hook, not an injected SDK. Implement it with the site's verified identity and persistence layer before enabling the route. Missing resolver/configuration returns 503; denied ownership returns 403 before any socket or PAT use. An app-only demo can return a fixed conversation only within an explicitly authorized restricted-user scope whose ingress protection has been verified.

The browser opens `/functions/v1/app?action=realtime&conversation=<application ID>`. [qca-realtime.mjs](../assets/qca-realtime.mjs) connects only to `/api/v1/forward/realtime?conversation_id=<resolved conv ID>`, keeps the PAT in the server handshake and gates client input on `voice.ready`. It forwards selected captions, audio, state and playback identifiers, reduces work events to status, maps errors to safe application codes and drops unrecognized event types. Extend that projection explicitly for requested work results/tool approval UI; never forward raw tool arguments, internal progress or upstream errors.

The included HTML sends one test text after **Send test text** and reports final captions and received PCM bytes. It does not capture or play sound; it sends `playback.cancelled` because no playback occurs. This is an executable connectivity slice, not a completed microphone UI. A protocol-level connection may still fail in production if authenticated outbound WebSocket is unsupported; report that precise boundary and use a separately authorized compatible backend, without claiming that Sites pages cannot use WebSocket.

## Configure relay limits

When adapting the handler, pass policy options directly to `relayRealtime(socket, options)` alongside its server-owned `origin`, `conversationId`, `getToken` and `connect`. The bundled demo handler uses the defaults below. These are application demo bounds, not Sites runtime quotas.

| Option | Default | Scope |
| --- | --- | --- |
| `readyTimeoutMs` | `10000` | From relay setup until `voice.ready` |
| `connectTimeoutMs` | `10000` | Upstream WebSocket handshake |
| `maxDurationMs` | `55000` | Each socket's total lifetime |
| `maxMessages` | `3000` | Received frames per socket, including control events |
| `maxMessageBytes` | `262144` | Each received or forwarded frame, including JSON/Base64 |
| `maxBufferedBytes` | `524288` | Queued output plus the next frame on each socket |

All values must be positive safe integers; timeout/lifetime values must also fit `1..2147483647` milliseconds. `maxMessageBytes` may tighten the helper's 256 KiB envelope bound but cannot raise it. Invalid policy closes the supplied downstream socket and throws `realtime_configuration_invalid` before reading the PAT or opening upstream. The helper owns protocol projection and cleanup; callback options cannot replace them. Choose longer lifetimes and matching frame budgets only after measuring the deployed Function/Gateway limits.

## Audio and lifecycle

All QCA frames are UTF-8 JSON text with `{ version: "voice.realtime.v1", type, payload }`. QCA rejects binary frames. Each client message, including the JSON envelope and Base64, is limited to 256 KiB. General Sites WebSocket binary capability does not change this protocol.

| Direction | Format and event |
| --- | --- |
| Input | `audio.append`, `payload.audio`: Base64 raw PCM16, signed little-endian, 16 kHz, mono; no WAV header |
| Output | `audio.delta`, `payload.audio`: Base64 PCM16, 24 kHz, mono |
| Text input | `text.message`, `payload.text`: nonempty after trimming, at most 16 KiB UTF-8 |

Wait for `voice.ready`; use its audio formats. Capture only after a user gesture and microphone permission over a secure origin. Convert the actual device sample rate/channels with an AudioWorklet/resampler; requesting 16 kHz does not prove that the device delivered it. `MediaRecorder` WebM/Opus chunks are not PCM. A 20 ms input chunk is 320 samples / 640 bytes at 16 kHz mono. QCA performs VAD; there is no audio commit event.

Decode output and schedule it in order at 24 kHz. Bound capture and playback queues as well as socket buffering. On `audio.done`, wait for the local queue to finish; it only marks server output completion. Send `playback.started`, `playback.ended` or `playback.cancelled` according to actual device behavior, echoing `work_id` / `announcement_id` from the corresponding audio event when present. A received chunk is not proof of playback.

User interrupt: stop playback, clear its queue, send `playback.cancelled` for affected audio, then `interrupt`. Handle server `playback.interrupt` the same way locally. Stop capture and playback before sending `connection.close` with a fresh `request_id`; wait for the matching `connection.closed`, then close with a bounded fallback deadline. On unload, network error, replacement or timeout, stop media tracks, disconnect audio nodes and release both sockets.

Realtime supports application `ping`/`pong`; its server `sequence` resets per connection and is not a history cursor. Reconnect with the authorized existing conversation and bounded backoff when allowed; never replay previous audio/text automatically. QCA documents up to 60 minutes per connection. The relay demo intentionally stops at 55 seconds, and the actual Function/Gateway lifetime must be measured separately. For a longer product session, adjust both message count and lifetime after that validation.

## Acceptance

Use one bounded conversation through the complete browser → deployed Function → QCA path: observe `voice.ready`, a text input, final caption, audio and matching graceful close; reuse it for transport validation. If microphone voice is requested, also exercise capture/resampling, audible playback and interruption. Check denied ownership, invalid/oversized input, slow-consumer cleanup and disconnect handling when changing those boundaries. Local fixtures use no PAT or cloud resources.

Prior Global PROD evidence from 2026-09-20 established browser → Function text/binary echo and, separately, a local Deno client → QCA with final caption and four audio chunks (72,960 PCM bytes). The combined deployed relay and actual microphone/playback were not verified by those checks. Keep fixture results, independent live segments, combined integration and device behavior distinct in delivery reports.
