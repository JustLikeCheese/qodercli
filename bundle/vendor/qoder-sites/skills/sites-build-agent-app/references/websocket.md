# WebSocket in Sites

Use this branch for duplex text/binary transport, a WebSocket connectivity demo, or the transport layer of [QCA Realtime](realtime.md). A Managed SSE endpoint does not limit the protocols available to site code.

| Connection | Implementation and boundary |
| --- | --- |
| Browser → external WSS | Native `WebSocket`; suitable when the upstream permits browser authentication. Keep server credentials out of browser code, URLs and subprotocols. |
| Browser → same-origin Function | `Deno.upgradeWebSocket(request)` in the single `app` Function. Site access and application authorization still apply. |
| Function → upstream WSS | Use a runtime client that supports the upstream's authentication; verify that exact client in the deployed Edge runtime. |
| Bidirectional binary data | Set `binaryType = 'arraybuffer'`; send `ArrayBuffer`/typed arrays. Encoding and sample rates belong to the application protocol. |

The browser connects to `wss://${location.host}/functions/v1/app?action=ws-echo` on HTTPS, or `ws:` on localhost. The action is implemented by the example, not a platform-provided endpoint. Preserve the existing site's routes. A WebSocket Upgrade is an HTTP request handled by the Function, not a request to start a persistent Node server.

## Run the credential-free demo

[The demo page](../assets/realtime-demo/index.html) sends text and a 640-byte binary frame and compares the returned bytes. [The handler](../assets/realtime-demo/handler.mjs) uses [websocket.mjs](../assets/websocket.mjs) to bound message size/count, buffered sends and connection lifetime. The echo route is anonymous application code with no private data or credentials; keep it diagnostic-only.

Check `deno --version` first, then run from this installed skill directory:

```bash
deno check --no-config --no-lock --no-npm --node-modules-dir=none assets/realtime-demo/local.ts
deno run --no-config --no-lock --no-npm --node-modules-dir=none \
  --allow-net=127.0.0.1:8000 --allow-read=assets/realtime-demo/index.html \
  assets/realtime-demo/local.ts
```

If Deno is unavailable, follow [Local tools](../../sites-building/references/environment.md#local-tools). Continue independent page/handler work and keep local Upgrade/echo checks pending; an ordinary static server cannot execute this Deno handler. Hosted verification still follows the user's existing deployment authorization.

Open `http://127.0.0.1:8000/` and select **Run echo**. The local entry point serves only a fixture; QCA is disabled until the application supplies a verified conversation resolver. Keep `local.ts` outside the deployed Function package.

To reuse the demo in a site, copy `websocket.mjs`, `qca-realtime.mjs` and `realtime-demo/handler.mjs` into the Function directory, preserving their relative layout. Use this echo-only entry point, replacing the origin with the actual approved site origin:

```ts
import { createRealtimeDemoHandler } from './realtime-demo/handler.mjs';
Deno.serve(createRealtimeDemoHandler({ siteOrigin: 'https://YOUR_SITE_HOST' }));
```

Place the demo HTML in the frontend output only when the user requests a diagnostic page. Functions readiness is required for hosted echo; it does not require `qoder`, a PAT, a database or QCA resources. Use the existing building/hosting workflow for authorized publication.

For an existing Vite frontend, preserve the path and enable WebSocket forwarding in the local proxy:

```js
server: { proxy: { '/functions/v1/app': { target: 'http://127.0.0.1:8000', ws: true } } }
```

Set the handler's `siteOrigin` to the actual frontend development origin in that setup. A static file server or an HTTP-only proxy does not exercise Upgrade forwarding.

## Authenticated relays

Authorize the visitor, application conversation and quota before Upgrade. Validate `Origin` against trusted site configuration to prevent cross-site WebSocket requests; it is not proof of user identity. For Gateway user context, reuse [Function identity](../../sites-building/references/functions.md#site-access-and-visitor-identity), including provider bypass protection. Browser WebSocket cannot attach custom `Authorization` headers; use the verified same-origin login path. If that authentication contract is absent, keep the relay unavailable instead of moving the PAT into a query parameter.

For a non-QCA upstream, `relayWebSockets(socket, connectUpstream, options)` preserves text/binary frames. `connectUpstream` must select a fixed server-controlled destination. Supply synchronous `clientMessage` and `serverMessage` projections for the actual protocol; returning `undefined` drops an event. Transparent forwarding is appropriate only for a protocol whose entire allowed payload has been reviewed. The helper connects after the downstream opens, rejects sends before upstream readiness, closes both sockets on failure and never replays messages.

Default demo policy is 256 KiB per message, 512 KiB queued output, 3,000 received messages per socket, a 10-second upstream handshake deadline and a 55-second lifetime. Echo lowers the message limit to 4 KiB. These are configurable demo bounds, not advertised Sites quotas. Measure the deployed runtime's idle timeout, lifetime, traffic and concurrency limits before choosing product settings. Use application heartbeat events only when the upstream protocol supports them; browser code cannot send WebSocket protocol-level ping frames.

## Validation boundary

Validate the changed transport through its real route: HTTP 101, text/binary fidelity, and cleanup after close/error or an exceeded limit. For a private site, complete normal login/consent before opening the socket; a login redirect or HTML response is not a successful handshake. Same-origin cookies are handled by the browser, not copied from management tools.

A Global PROD check on 2026-09-20 demonstrated browser → Function echo with 1,500 × 640-byte frames at 20 ms intervals, zero mismatches, about 30 seconds. It establishes that path at that time; it does not certify every environment, long-lived connections or a credential-bearing outbound relay. Revalidate the target when delivering an application. The separate [Realtime acceptance](realtime.md#acceptance) covers QCA and actual audio devices.
