---
name: sites-build-agent-app
description: Add Qoder Cloud Agents to Qoder Sites for AI assistants, persistent chat, agent execution and realtime voice. Includes SSE and WebSocket text/binary demos. This capability skill extends sites-building; use sites-hosting for hosted delivery.
---

# Build a QCA-powered experience

Base directory for this skill: `${QODER_PLUGIN_ROOT}/skills/sites-build-agent-app`. Resolve relative links and resource paths from this directory; links inside a reference document are relative to that document.

Run Sites through the Bash tool with the exact host command below. Windows requires Git Bash; PowerShell-only sessions are not supported:

```text
${SITES_COMMAND} <operation> --input '<JSON>'
```

For JSON containing quotes, multiline text or shell metacharacters, write a UTF-8 JSON file inside the current project with the file tool, then use `--input-file <path>` instead of inline `--input`. Run one Sites command per shell call; do not use pipes, command substitution or a heredoc.

Run the exact command directly as one foreground shell invocation, keeping its session argument. The host supplies the current credential; never read or pass credentials manually.

In examples, `sites` means this full command, including `--session`. Discover operations with `sites list` and inputs with `sites describe <operation>`. SessionStart must have created the context; if it is missing, report the failure and restart the host session. If the host shell tool is unavailable, report that Sites execution is unavailable in this host. Use the CLI for all 32 business operations. On Desktop, use the `qoder_sites` MCP `show_publish_confirmation` only to open the frozen preview after checking publication status. Native CLI/Wake return the verified result directly.

Add the requested AI capability to the same website and project being built with [sites-building](../sites-building/SKILL.md). Continue that workflow rather than initializing another site or repeating its design/setup steps. Use [sites-hosting](../sites-hosting/SKILL.md) for hosted delivery.

For QCA, the runtime path is **browser → same-origin Sites Function → Qoder Cloud Agents**. The Function reads the platform's `QODER_PAT`; the browser receives only application content and status. Qoder Desktop's management login is a separate credential boundary.

## 1. Define the useful interaction

Identify what the user asks the agent to do, which application users may invoke it, what tools it actually needs, and whether work continues across visits. Make the primary AI interaction visible in the site's working surface; do not replace it with an advertisement for an assistant. Keep scope, copy and visual direction aligned with the rest of the site.

Choose the smallest suitable tool set and fixed server-side configuration. Preserve requested transport or interaction choices. Model selection, system instructions, tools and upstream destinations stay under server control.

| Requested interaction | Read for this path |
| --- | --- |
| Managed chat with incremental text | Start from [Runnable SSE chat](references/chat-example.md) when a complete UI/local flow helps; use [Managed API](references/api.md) and [SSE](references/streaming.md) for live integration |
| Realtime voice, live captions or duplex QCA interaction | [Forward Realtime](references/realtime.md); use its Identity/Template/Conversation workflow |
| General WebSocket text/binary messages or a transport check | [WebSocket demo](references/websocket.md); Functions only, skip QCA setup in steps 2–4 and use the demo's transport acceptance |
| Background Managed work without incremental output | [Managed API](references/api.md); bounded history/state polling for the selected operation |

SSE is one QCA API transport, not a Sites runtime restriction. Sites pages can open WebSockets, and a Sites Function can upgrade a request. Keep general binary transport separate from QCA Realtime's JSON/Base64 audio protocol.

Before QCA implementation or resource allocation, choose a supported execution scope. For per-user or resumable conversations, verify [visitor identity](../sites-building/references/functions.md#site-access-and-visitor-identity), private persistence and the [durable coordinator](references/initialization.md#resource-scopes-and-durable-intents). New persistent applications use [Function backend](../sites-building/references/function-backend.md); consult [legacy database identity](../sites-building/references/database.md#identity-and-coordination) only for existing legacy allocations. Neither a ready backend nor the Function backend SDK supplies a durable conversation service or distributed coordinator. If a required contract is missing, report that dependency and continue independent work. A fixed server-configured Session or Realtime Conversation is only an explicitly agreed limited slice; it does not satisfy requested multi-user isolation, concurrent sends or history recovery. Keep fixture routes in local adapters and make the real UI use the real server endpoints.

Once scope is known, implement one executable path before extending the design. For local-only work or an unavailable dependency, skip live API setup and resource allocation. For SSE, adapt the [complete local chat example](references/chat-example.md), or use the [application stream consumer](references/streaming.md#application-stream-consumption) in an existing UI. Read further references only for the next implemented dependency. Report missing identity/persistence contracts once, then complete the independent slice without designing a replacement platform.

## 2. Establish the server connection

Before writing live QCA requests, call `get_context` with empty arguments and use the API reference selected above. Copy `runtime.cloudAgents.apiOrigin` into server-only configuration for the selected client. Use the host-issued mapping exactly; do not infer it from language, website hostname or documentation examples. An unconfigured origin blocks live integration, not local application development.

The bundled [Managed client](assets/cloud-agents.mjs) supplies bounded authenticated requests and safe error codes; instantiate it with `createCloudAgentsClient({ origin })`. For voice, use the separate [Realtime relay](assets/qca-realtime.mjs). Copy required assets into the Function directory and use relative imports. These are transport helpers, not complete conversation services. Recheck the runtime context when resuming or changing the target; changed server configuration requires a new prepared draft.

Managed chat uses `/api/v1/cloud/*`; Forward Realtime uses `/api/v1/forward/realtime` and its conversation creation endpoint. Keep their resource IDs, events and recovery contracts separate. Consult the current linked contract before adding an operation beyond the bundled workflow. A configured route does not prove upstream reachability or token validity.

## 3. Prepare the site's AI capability

Follow [Prepare the site](references/initialization.md#prepare-the-site) within the user's backend-allocation authorization. Reuse existing Project/Site IDs. For a new site, the bootstrap draft obtains those IDs from the real built frontend and remains unpublished; only the complete AI draft is presented for publication.

Read `get_site(include: ["backend"])` first. Reuse an already-ready `qoder` capability. Before enabling it, explain in the user's language that the platform will automatically create a Qoder PAT for their account, securely configure it as the site's server-side `QODER_PAT`, and use it to authenticate the site's calls to Qoder Cloud Agents. Ask for explicit confirmation covering both enablement and PAT creation/use. For example: “开启此站点的 Qoder 后端服务时，系统会自动为你创建 Qoder PAT，并安全配置到站点后端，供 Qoder Cloud Agent 调用使用。是否确认开启并创建？” A general request to build an AI site, allocate a backend or publish is not this confirmation. Reuse an existing explicit confirmation for the same site and purpose; do not ask twice.

Wait for the user's affirmative reply before calling `ensure_backend` with `qoder` or otherwise initiating PAT creation. If declined or unanswered, continue local development with credential-free fixtures and leave live AI enablement pending. After confirmation, call `ensure_backend` for `qoder` with the actual Site ID and stable request ID. It includes Functions and provisions the platform Secret. Wait for the Operation and verify the capability through `get_site(include: ["backend"])`. Add database or Storage only when the application needs them. Backend setup, first-use Cloud resource creation and publication are separate lifecycles.

Read `Deno.env.get('QODER_PAT')` only inside the Function. Do not ask for a pasted PAT, rename it to an application Secret, write it through ordinary Secret tools, declare it in `prepare_site.secretNames`, or pass it into browser code, prompts or Session environments. The filtered Secret list cannot tell whether this platform Secret exists. A missing/invalid token produces a safe service error; it does not authorize minting a token, changing regions or reallocating the backend from the Function.

## 4. Initialize once and resume safely

Use the identity adapter for the selected backend: Function backend uses `requireUser(ctx)` from its injected SDK; the standalone [visitor identity helper](../sites-building/references/functions.md#site-access-and-visitor-identity) uses `requireUser(request)`. Look up durable conversation mappings by the verified site/user and check ownership before sending, reading, streaming or interrupting. Identity context does not itself provide durable mapping, atomic coordination or history recovery. Anonymous Function mode alone does not prevent server-side QCA calls.

For Managed chat, read [First-use initialization](references/initialization.md#lazy-bootstrap) before implementing live resource creation or dispatch. It defines resource reuse, the required durable coordinator, reserved metadata, pinned versions and Session/message intents. For Realtime, use [conversation creation and ownership](references/realtime.md#conversation-creation-and-ownership); its resources and idempotency contract differ. Initialize only on an authorized start/message POST after validation and quotas; page loads and reconnects reuse existing bindings.

An unknown QCA dispatch result must remain pending until reconciled; a database uniqueness check alone cannot make an external message exactly-once.

## 5. Complete the application flow

Build the smallest authorized end-to-end application slice first: browser action → deployed Function → QCA → final reply, with the ownership and persistence needed for that slice. Extend domain tools and application features after this path works. Missing optional integrations need not block a clearly scoped connectivity check; such a check does not satisfy features that depend on those integrations. Follow sites-hosting to publish the complete changed draft, honoring explicit deferral.

Expose only the bounded Function endpoints and events the chosen transport needs. Accept prompt text, application conversation IDs and stable request IDs; resolve Cloud IDs and configuration on the server. Validate methods, message type, size and authorization before upstream calls. Never expose a generic authenticated proxy.

For SSE, read [Streaming](references/streaming.md) and reuse [sse.mjs](assets/sse.mjs). The Function authenticates upstream, projects permitted message/status content, persists history and reconnect cursors, and closes the upstream stream when done. Reconnection retrieves progress without resending the user message. Preserve explicit polling requirements.

For WebSocket or realtime voice, follow the [transport demo](references/websocket.md) or [QCA Realtime integration](references/realtime.md). Authorize the Upgrade request before opening a credential-bearing upstream connection. Implement ready, interrupted and disconnected states; stop capture/playback and release both sockets on exit. Reconnect explicitly without replaying audio or text.

Implement the states the chosen flow needs: initialization, running, waiting for input, completed, interrupted and failed. Keep the primary action and recovery clear. Escape Agent text or use sanitized Markdown. Include usage/input limits and cancellation for long work. Restore the active conversation by loading its authorized history on mount. Starting a new conversation clears the old active state and cancels its reader; stale responses must not update the new view. A reload must not send a prompt again; a 202 response means accepted work, not a completed answer. Do not automatically approve Agent tool actions that require user authorization.

Read [Runtime diagnosis](references/diagnostics.md) for upstream failures or application usage counts. Keep safe diagnostic IDs at request boundaries and translate errors into user-facing application text; do not relay raw upstream payloads, credentials or internal routing.

## 6. Validate and hand back to publication

Follow [sites-building's validation scope](../sites-building/SKILL.md#validation-scope) and reuse its build and main-flow results. QCA integration does not require a separate fixture suite. Add a targeted check only for initialization, ownership, persistence or transport logic changed by this task; the reference documents describe those checks on demand.

Return to the original site's [publication workflow](../sites-hosting/SKILL.md) once the complete draft and required capabilities are ready. `canPublish: true` proves draft readiness only. For hosted AI delivery, verify one real conversation through the site's Function using the authorized Site and account: message acceptance and a final reply, including saved history if requested. This is the AI main-flow check; reuse it across validation steps. For SSE, observe incremental output in that same request. Test reconnect or usage accounting separately only when that logic changes or a failure points to it. Local-only work can use credential-free fixtures and report real execution as unverified.

Before deployed acceptance, follow [Verify the target version](../sites-hosting/SKILL.md#verify-the-target-version).

For voice, verify the combined browser → deployed Function → QCA path, then microphone capture, PCM conversion, actual playback and interruption when requested. Text/binary echo and a separate server-to-QCA check establish individual capabilities; they do not establish the combined voice flow or a 60-minute Function lifetime.

Describe local fixture results, site publication and real AI execution separately. A ready backend or HTTP 200 alone is not an AI acceptance result. If the integration cannot run, deliver the working local preview and explain the exact user-visible blocker without recommending a dependent release as ready.

For application data or files, use [Function backend](../sites-building/references/function-backend.md) and [Storage](../sites-building/references/storage.md). Maintain an existing legacy allocation through [Legacy database access](../sites-building/references/database.md). Keep private AI bindings, coordination and conversation ownership separate from public sample-data policies.
